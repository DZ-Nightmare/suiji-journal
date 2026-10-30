#!/usr/bin/env node
'use strict';
/* 随记 · 多设备同步对账：从远端密文载荷把本地 vault 缺的明文长回来（只增不删）
   用法：node tools/sync.js [--pull]     （--pull 是冷启动语义别名，行为相同）
   原理见 docs/多设备同步设计.md：
   - journal.enc.json 的 raw 字段即明文原文，附件按内容哈希解密（同一查看密码）
   - 远端载荷取自 origin/main 的 git 对象，不依赖工作区状态
   - 只增不删：远端有而本地没有的写回 vault；两边都有但不同的，本地为准、
     远端版本存入 vault/_sync-conflicts/（不参与构建）留痕
   明文永不出本机；密码取自 journal.config.json，绝不打印。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./lib');

function gitShow(ref) {
  return execFileSync('git', ['show', ref], { cwd: lib.ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitFetch() {
  try {
    execFileSync('git', ['fetch', 'origin'], { cwd: lib.ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* 离线时用现有 remote-tracking 引用 */ }
}

function conflictName(dir, filename) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const ext = path.extname(filename);
  const base = filename.replace(/\.[^.]+$/, '');
  let name = `${base}-远端-${stamp}${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${base}-远端-${stamp}-${n++}${ext}`;
  return name;
}

function conflictWrite(conflictDir, rel, raw, kind) {
  fs.mkdirSync(conflictDir, { recursive: true });
  const name = conflictName(conflictDir, path.basename(rel));
  fs.writeFileSync(path.join(conflictDir, name), raw.endsWith('\n') ? raw : raw + '\n');
  console.log(`  ⚠ ${kind}两边内容不同：保留本地版本，远端版本存入 vault/_sync-conflicts/${name}`);
}

function reconcile() {
  const config = lib.loadConfig();
  const password = process.env.JOURNAL_PASSWORD || config.password;
  if (!password) throw new Error('未配置查看密码（journal.config.json 或环境变量 JOURNAL_PASSWORD）');
  const vaultDir = path.join(lib.ROOT, config.vault || 'vault');
  const conflictDir = path.join(vaultDir, '_sync-conflicts');

  gitFetch();  // 先刷新 remote-tracking 引用（独立使用时 origin/main 可能是旧的）

  let enc;
  try {
    enc = JSON.parse(gitShow('origin/main:journal.enc.json').toString('utf8'));
  } catch {
    console.log('· 远端没有加密载荷（全新仓库或无 origin），无需对账');
    return;
  }

  const payload = lib.decryptPayload(enc, password);
  const entries = [
    ...(Array.isArray(payload.notes) ? payload.notes : []).map(n => ({ ...n, kind: '随记' })),
    ...(Array.isArray(payload.lists) ? payload.lists : []).map(n => ({ ...n, kind: '书影' })),
  ];
  let restored = 0, skipped = 0, conflicted = 0;

  for (const e of entries) {
    if (!e.rel || !e.raw) continue;
    const target = path.join(vaultDir, e.rel);
    const raw = e.raw.endsWith('\n') ? e.raw : e.raw + '\n';
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, raw);
      restored++;
      console.log(`✓ 恢复${e.kind}明文：${e.rel}（${e.title || '无题'}）`);
      continue;
    }
    const cur = fs.readFileSync(target, 'utf8');
    if (cur === raw || cur === e.raw) { skipped++; continue; }
    conflicted++;
    conflictWrite(conflictDir, e.rel, e.raw, e.kind);
  }

  const seen = new Set();
  let restoredAtt = 0;
  for (const e of entries) {
    for (const a of (e.attachments || [])) {
      if (!a.name || !a.aad || seen.has(a.file)) continue;
      seen.add(a.file);
      const hash = a.aad.split(':')[1];
      const target = path.join(vaultDir, 'Attachments', a.name);
      if (fs.existsSync(target)) {
        const localHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex').slice(0, 20);
        if (localHash === hash) { skipped++; continue; }
        // 附件双改：本地为准，远端版本明文（二进制）存副本留痕
        const bin = gitShow(`origin/main:${a.file}`);
        const plain = lib.decryptAttachment(bin, password, enc.salt, hash);
        fs.mkdirSync(conflictDir, { recursive: true });
        const name = conflictName(conflictDir, a.name);
        fs.writeFileSync(path.join(conflictDir, name), plain);
        conflicted++;
        console.log(`  ⚠ 附件两边内容不同：保留本地版本，远端版本存入 vault/_sync-conflicts/${name}`);
        continue;
      }
      const bin = gitShow(`origin/main:${a.file}`);
      const plain = lib.decryptAttachment(bin, password, enc.salt, hash);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, plain);
      restoredAtt++;
      console.log(`✓ 恢复附件明文：${a.name}（${plain.length} bytes）`);
    }
  }

  console.log(`✓ 对账完成：恢复 ${restored} 篇随记/书影、${restoredAtt} 个附件；跳过 ${skipped} 项；冲突留痕 ${conflicted} 项`);
  if (conflicted) console.log('⚠ 有冲突副本待人工合并（vault/_sync-conflicts/，不参与构建）');
}

function main() {
  const pullMode = process.argv.includes('--pull');
  if (pullMode) console.log('冷启动/恢复模式：从远端密文载荷长出明文（只增不删）');
  reconcile();
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('✗ 同步失败：' + e.message); process.exit(1); }
}
module.exports = { reconcile, main };
