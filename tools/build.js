#!/usr/bin/env node
'use strict';
/* 随记 · 构建：把 vault 明文加密成 journal.enc.json + media/*.bin
   用法：node tools/build.js   （密码取自 journal.config.json，可用 JOURNAL_PASSWORD 环境变量覆盖） */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function main() {
  const config = lib.loadConfig();
  const password = process.env.JOURNAL_PASSWORD || config.password;
  if (!password) throw new Error('未配置查看密码（journal.config.json 的 password 或环境变量 JOURNAL_PASSWORD）');

  const notes = lib.scanVault(config);
  const mediaDir = path.join(lib.ROOT, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  // 整包与附件共用同一 salt，密码只需派生一次
  const saltB64 = lib.b64(lib.randBytes(24));
  const keep = new Set();

  const finalNotes = notes.map(note => {
    const { _content, ...clean } = note;
    return {
      ...clean,
      attachments: note.attachments.map((a, i) => {
        const hash = a.aad.split(':')[1];
        fs.writeFileSync(path.join(mediaDir, `${hash}.bin`), lib.encryptAttachment(_content[i].content, password, saltB64, hash));
        keep.add(`${hash}.bin`);
        return { name: a.name, mime: a.mime, size: a.size, file: `media/${hash}.bin`, aad: a.aad };
      }),
    };
  });

  // 清理不再被引用的加密附件
  for (const file of fs.readdirSync(mediaDir)) {
    if (!keep.has(file)) fs.unlinkSync(path.join(mediaDir, file));
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const built = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}+08:00`;
  const payload = { notes: finalNotes, built_at: built };
  const enc = lib.encryptPayload(payload, password, saltB64);
  fs.writeFileSync(path.join(lib.ROOT, 'journal.enc.json'), JSON.stringify(enc));

  // 静态资源版本号：防止旧缓存呈现破版（用户浏览器缓存 styles.css/app.js 导致新功能不可见）
  const indexFile = path.join(lib.ROOT, 'index.html');
  const stamp = Date.now();
  let html = fs.readFileSync(indexFile, 'utf8');
  html = html.replace(/(styles\.css|app\.js|icon\.svg)(\?v=\d+)?/g, `$1?v=${stamp}`);
  fs.writeFileSync(indexFile, html);

  const days = new Set(finalNotes.map(n => n.date)).size;
  console.log(`✓ 已加密 ${finalNotes.length} 篇随记（${days} 个记录日）→ journal.enc.json`);
  console.log(`✓ 已加密 ${keep.size} 个附件 → media/`);
  console.log(`✓ 构建时间 ${payload.built_at}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('✗ 构建失败：' + e.message); process.exit(1); }
}
module.exports = { main };
