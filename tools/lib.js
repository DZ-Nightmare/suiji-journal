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

/* 整包解密：encryptPayload 的逆运算（多设备对账 sync.js 用，参数与站点端一致） */
function decryptPayload(enc, password) {
  const key = deriveKey(password, Buffer.from(enc.salt, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.nonce, 'base64'));
  d.setAAD(Buffer.from(AAD_JOURNAL));
  const ct = Buffer.from(enc.ciphertext, 'base64');
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/* 附件解密：encryptAttachment 的逆运算（bin = 12 字节 IV + 密文 + 16 字节标签） */
function decryptAttachment(bin, password, saltB64, hashHex) {
  const key = deriveKey(password, Buffer.from(saltB64, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, bin.subarray(0, 12));
  d.setAAD(Buffer.from(`attachment:${hashHex}`));
  d.setAuthTag(bin.subarray(bin.length - 16));
  return Buffer.concat([d.update(bin.subarray(12, bin.length - 16)), d.final()]);
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
        if (entry.name === 'Attachments' || entry.name === '03-Lists' || entry.name === '_sync-conflicts' || entry.name.startsWith('.')) continue;
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
    rel: n.rel,
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

/* ---------- 清单（03-Lists）解析 ---------- */

/* 感想流：`## 感想` 段内按 `### MM-DD · 小标题` 分块（段内允许 ### 小标题，只在下一个 ## 处结束） */
function extractRemarks(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+感想\s*$/.test(l.trim()));
  const remarks = [];
  if (start < 0) return remarks;
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const h = line.match(/^###\s+(\d{1,2}-\d{1,2})(?:\s*[·・.]\s*(.*))?$/);
    if (h) {
      cur = { date: h[1], title: (h[2] || '').trim(), text: '' };
      remarks.push(cur);
    } else if (cur) {
      cur.text += (cur.text ? '\n' : '') + line;
    }
  }
  return remarks.map(r => ({ ...r, text: r.text.trim() }));
}

/* 正文里的 wiki 链接（去掉附件引用，去 .md 后缀），供双向互链用 */
function findWikiLinks(body) {
  const out = [];
  for (const m of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const t = m[1].trim().replace(/\.md$/, '');
    if (!t.startsWith('Attachments/')) out.push(t);
  }
  return [...new Set(out)];
}

/* 扫描 03-Lists，产出与网页端约定一致的 lists 数组（未加密）
   字段缺失按默认处理；added 是唯一日期依据，排序规则与随记一致（升序保 id 稳定） */
function scanLists(config) {
  const vaultDir = path.join(ROOT, config.vault || 'vault');
  const listDir = path.join(vaultDir, '03-Lists');
  const attachDir = path.join(vaultDir, 'Attachments');
  if (!fs.existsSync(listDir)) return [];
  const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

  const parsed = fs.readdirSync(listDir).filter(n => n.endsWith('.md')).sort().map(name => {
    const file = path.join(listDir, name);
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);
    const rel = path.posix.join('03-Lists', name);
    const attachNames = findAttachments(body, data);
    const attachments = [];
    for (const aName of attachNames) {
      const afile = path.join(attachDir, aName);
      if (!fs.existsSync(afile)) { console.warn(`  ! 附件缺失：${aName}（${rel}）`); continue; }
      const content = fs.readFileSync(afile);
      attachments.push({ name: aName, content, size: content.length, mime: mimeOf(aName), hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 20) });
    }
    return {
      rel,
      added: String(data.added || data.date || '').slice(0, 10),
      type: data.type === 'movie' ? 'movie' : 'book',
      title: shortTitle(data, body),
      creator: data.creator ? String(data.creator) : '',
      year: data.year ? String(data.year) : '',
      status: ['want', 'doing', 'done'].includes(String(data.status)) ? String(data.status) : 'want',
      priority: num(data.priority),
      rating: num(data.rating),
      started: String(data.started || '').slice(0, 10),
      finished: String(data.finished || '').slice(0, 10),
      progress: data.progress ? String(data.progress) : '',
      tags: Array.isArray(data.tags) ? data.tags.map(String) : (data.tags ? [String(data.tags)] : []),
      remarks: extractRemarks(body),
      links: findWikiLinks(body),
      body: body.trim(), raw: text, attachments,
    };
  }).filter(n => n.added);

  // 升序排（与随记同规则）：新条目追加在尾部，List-XXX 编号与深链跨构建稳定
  parsed.sort((a, b) => a.added.localeCompare(b.added) || a.rel.localeCompare(b.rel));
  return parsed.map((n, i) => ({
    id: `List-${String(i + 1).padStart(3, '0')}`,
    anchor: `list-${String(i + 1).padStart(3, '0')}`,
    rel: n.rel,
    type: n.type, title: n.title, creator: n.creator, year: n.year,
    status: n.status, priority: n.priority, rating: n.rating,
    added: n.added, started: n.started, finished: n.finished, progress: n.progress,
    tags: n.tags, remarks: n.remarks, links: n.links,
    body: n.body, raw: n.raw,
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
    '.html': 'text/html', '.htm': 'text/html', '.csv': 'text/csv', '.json': 'application/json',
  })[ext] || 'application/octet-stream';
}

module.exports = { ROOT, ITERATIONS, loadConfig, deriveKey, encryptPayload, encryptAttachment, decryptPayload, decryptAttachment, parseFrontmatter, scanVault, scanLists, findWikiLinks, mimeOf, weekdayOf, randBytes, b64 };
