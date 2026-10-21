#!/usr/bin/env node
'use strict';
/* 随记 · 发布：构建加密数据并推送到 GitHub（Pages 自动更新）
   用法：node tools/publish.js [--message "add: 2026-10-20 随笔"]
   说明：只推送加密产物（journal.enc.json / media/），vault 明文永不入库。 */
const { execFileSync } = require('child_process');
const path = require('path');
const lib = require('./lib');

function main() {
  const messageArg = process.argv.slice(2).find((a, i, arr) => arr[i - 1] === '--message');
  require('./build').main();

  const git = (...args) => execFileSync('git', args, { cwd: lib.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  git('add', 'journal.enc.json', 'media');
  let changed = true;
  try { changed = !!git('status', '--porcelain', 'journal.enc.json', 'media'); } catch { }
  if (!changed) { console.log('· 内容没有变化，无需推送'); return; }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  git('commit', '-m', messageArg || `随记更新 ${stamp}`);
  git('push');
  console.log('✓ 已推送到 GitHub，GitHub Pages 将在约 1 分钟内更新');
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error('✗ 发布失败：' + e.message);
    if (e.stderr) console.error(String(e.stderr).trim());
    process.exit(1);
  }
}
module.exports = { main };
