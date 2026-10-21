'use strict';
/* 随记 · 共享工具库：配置 / 加密 / vault 解析 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ITERATIONS = 600000;
const AAD_JOURNAL = 'journal:v1';

function loadConfig() {
  const file = path.join(ROOT, 'journal.config.json');
  if (!fs.existsSync(file)) {
    throw new Error('缺少 journal.config.json（该文件不入库，仅保存在本机）。可复制 journal.config.example.json 并填入查看密码。');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
}

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function randBytes(n) { return crypto.randomBytes(n); }

/* 整包加密：AES-256-GCM，密文末尾附 16 字节认证标签（与 WebCrypto 一致）
   传入 fixedSaltB64 可让附件与整包共用同一 salt（同一派生密钥） */
function encryptPayload(payload, password, fixedSaltB64) {
  const salt = fixedSaltB64 ? Buffer.from(fixedSaltB64, 'base64') : randBytes(24);
  const nonce = randBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(AAD_JOURNAL));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  return {
    version: 1,
    iterations: ITERATIONS,
    salt: b64(salt),
    nonce: b64(nonce),
    ciphertext: b64(Buffer.concat([ct, cipher.getAuthTag()])),
  };
}

/* 附件加密：12 字节 IV 前缀 + 密文 + 16 字节标签，AAD 绑定内容哈希 */
function encryptAttachment(content, password, saltB64, hashHex) {
  const key = deriveKey(password, Buffer.from(saltB64, 'base64'));
  const iv = randBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`attachment:${hashHex}`));
  const ct = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

/* ---------- vault 解析 ---------- */

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  let currentKey = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    const kv = rawLine.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const value = kv[2].trim();
      if (value === '') { data[currentKey] = []; }
      else if (value.startsWith('[') && value.endsWith(']')) {
        data[currentKey] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else { data[currentKey] = value.replace(/^["']|["']$/g, ''); }
    } else {
      const li = rawLine.match(/^\s+-\s+(.*)$/);
      if (li && currentKey) {
        if (!Array.isArray(data[currentKey])) data[currentKey] = data[currentKey] === '' || data[currentKey] === undefined ? [] : [data[currentKey]];
        data[currentKey].push(li[1].trim().replace(/^["']|["']$/g, ''));
      }
    }
  }
  return { data, body: text.slice(m[0].length) };
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function extractQuote(body) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let started = false;
  for (const line of lines) {
    if (/^\s*>/.test(line)) { started = true; out.push(line.replace(/^\s*>\s?/, '')); }
    else if (started && line.trim() === '') break;
    else if (started) break;
  }
  return out.join('\n').trim();
}

function extractSection(body, names) {
  const lines = body.split(/\r?\n/);
  const grab = new RegExp(`^#{1,3}\\s*(${names.join('|')})\\s*$`);
  const collected = [];
  let inSection = false;
  for (const line of lines) {
    if (grab.test(line.trim())) { inSection = true; continue; }
    if (inSection && /^#{1,3}\s/.test(line)) break;
    if (inSection && line.trim() === '---') break;
    if (inSection) collected.push(line);
  }
  return collected.join('\n').trim();
}

function extractLabeled(body, labels) {
  for (const label of labels) {
    const re = new RegExp(`^\\*\\*${label}[^*]*\\*\\*[：:]\\s*(.*)$`, 'm');
    const m = body.match(re);
    if (m) return m[1].replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_, p, l) => (l ? l.slice(1) : p.split('/').at(-1))).trim();
  }
  return '';
}

function findAttachments(body, data) {
  const names = new Set();
  const re = /\[\[Attachments\/([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const m of body.matchAll(re)) names.add(m[1].trim());
  if (Array.isArray(data.attachments)) for (const a of data.attachments) names.add(String(a).trim());
  return [...names];
}

function shortTitle(data, body) {
  if (data.title) return String(data.title);
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : '无题';
}

/* 扫描 vault，产出与网页端约定一致的 notes 数组（未加密） */
function scanVault(config) {
  const vaultDir = path.join(ROOT, config.vault || 'vault');
  const attachDir = path.join(vaultDir, 'Attachments');
  const notes = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'Attachments' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        notes.push(full);
      }
    }
  };
  walk(vaultDir);

  const parsed = notes.map(file => {
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);
    const rel = path.relative(vaultDir, file);
    const date = String(data.date || path.basename(file).match(/\d{4}-\d{2}-\d{2}/)?.[0] || '').slice(0, 10);
    const type = rel.startsWith('02-Collection') ? 'collection' : 'journal';
    const attachNames = findAttachments(body, data);
    const attachments = [];
    for (const name of attachNames) {
      const afile = path.join(attachDir, name);
      if (!fs.existsSync(afile)) { console.warn(`  ! 附件缺失：${name}（${rel}）`); continue; }
      const content = fs.readFileSync(afile);
      attachments.push({ name, content, size: content.length, mime: mimeOf(name), hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 20) });
    }
    const quote = extractQuote(body);
    const thought = extractSection(body, ['想到', '核心', '思考']) || extractLabeled(body, ['核心', '一句话']) || quote;
    return {
      date, type, rel,
      title: shortTitle(data, body),
      source: data.source ? String(data.source) : (type === 'collection' ? '沉淀' : '随笔'),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : (data.tags ? [String(data.tags)] : []),
      topics: Array.isArray(data.topics) ? data.topics.map(String) : (data.topics ? [String(data.topics)] : []),
      quote, thought, body: body.trim(), raw: text, attachments,
    };
  }).filter(n => n.date);

  parsed.sort((a, b) => a.date.localeCompare(b.date) || a.rel.localeCompare(b.rel));
  return parsed.map((n, i) => ({
    id: `Card-${String(i + 1).padStart(3, '0')}`,
    anchor: `card-${String(i + 1).padStart(3, '0')}`,
    type: n.type,
    title: n.title,
    date: n.date,
    weekday: weekdayOf(n.date),
    source: n.source,
    topics: n.topics.length ? n.topics : [n.type === 'collection' ? '沉淀' : '随想'],
    tags: n.tags,
    quote: n.quote,
    thought: n.thought,
    body: n.body,
    raw: n.raw,
    attachments: n.attachments.map(a => ({
      name: a.name, mime: a.mime, size: a.size,
      file: `media/${a.hash}.bin`,
      aad: `attachment:${a.hash}`,
    })),
    _content: n.attachments.map(a => ({ hash: a.hash, content: a.content })),
  }));
}

function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  })[ext] || 'application/octet-stream';
}

module.exports = { ROOT, ITERATIONS, loadConfig, deriveKey, encryptPayload, encryptAttachment, parseFrontmatter, scanVault, mimeOf, weekdayOf, randBytes, b64 };
