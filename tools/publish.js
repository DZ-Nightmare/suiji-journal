#!/usr/bin/env node
'use strict';
/* 随记 · 发布：多设备闭环——fetch → merge → 对账 → 构建 → 提交 → 推送（被拒自动重试）
   用法：node tools/publish.js [--message "add: 2026-10-20 随笔"]
   说明：
   - 只推送加密产物与站点文件（vault/ 与 journal.config.json 被 .gitignore 排除，明文永不入库）
   - 每次发布先把远端密文载荷里缺的明文对账进本地 vault（sync.js，只增不删），
     再全量构建——后推送者的构建天然包含所有设备的记录（docs/多设备同步设计.md）
   - 推送被拒（别的设备刚推过）→ 自动合并重建重试（最多 3 轮） */
const { execFileSync } = require('child_process');
const path = require('path');
const lib = require('./lib');

// 构建产物：build.js 全量重造，合并冲突时取远端即可
const GENERATED = /^(journal\.enc\.json|media\/)/;

function makeGit() {
  return (...args) => execFileSync('git', args, {
    cwd: lib.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28,
  }).trim();
}

/* index.html / app.js 的冲突只允许是版本号时间戳行（build 注入），否则交给人 */
function onlyStampsDiffer(git, file) {
  const norm = s => s
    .replace(/\?v=\d+/g, '?v=STAMP')
    .replace(/const VIEWER_VER = '[^']*';/, "const VIEWER_VER = 'STAMP';");
  try {
    return norm(git('show', `HEAD:${file}`)) === norm(git('show', `origin/main:${file}`));
  } catch {
    return false;
  }
}

function mergeRemote(git) {
  try { git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'); return; } catch { /* 落后，继续 */ }
  try { git('merge', '--no-edit', 'origin/main'); console.log('· 已合并远端提交'); return; } catch (e) { var mergeErr = e; /* 冲突或被本地改动阻挡，继续诊断 */ }
  const conflicted = git('status', '--porcelain')
    .split('\n')
    .filter(l => /^(UU|AA|AU|UA) /.test(l))
    .map(l => l.slice(3).trim());
  if (!conflicted.length) {
    const detail = mergeErr ? String(mergeErr.stderr || mergeErr.message).trim() : '';
    throw new Error('合并失败但未检测到冲突，请手动 git merge origin/main 查看' + (detail ? `（${detail.split('\n')[0]}）` : ''));
  }
  for (const f of conflicted) {
    const ok = GENERATED.test(f) || ((/^index\.html$|^app\.js$/.test(f)) && onlyStampsDiffer(git, f));
    if (!ok) throw new Error(`合并冲突需人工处理（非构建产物）：${f}。请手动 git merge origin/main 解决后重试。`);
  }
  for (const f of conflicted) git('checkout', '--theirs', '--', f);
  for (const f of conflicted) git('add', '--', f);
  git('commit', '--no-edit');
  console.log(`· 构建产物冲突已自动取远端（随后对账重建）：${conflicted.join('、')}`);
}

function main() {
  const messageArg = process.argv.slice(2).find((a, i, arr) => arr[i - 1] === '--message');
  const git = makeGit();

  for (let attempt = 1; attempt <= 3; attempt++) {
    // 0) 先固化本地未提交改动（若有），否则 merge 会被本地改动阻挡
    git('add', '-A');
    if (git('status', '--porcelain')) {
      const stamp0 = new Date().toISOString().slice(0, 16).replace('T', ' ');
      git('commit', '-m', `发布前固化本地改动 ${stamp0}`);
      console.log('· 已固化本地未提交改动');
    }
    // 1) 拉取并合并远端
    git('fetch', 'origin');
    mergeRemote(git);
    // 对账：远端密文载荷里缺的明文长回本地 vault（只增不删）
    require('./sync').reconcile();
    // 全量构建（含所有设备的记录）
    require('./build').main();

    git('add', '-A');
    let changed = true;
    try { changed = !!git('status', '--porcelain'); } catch { }
    if (!changed) { console.log('· 内容没有变化，无需推送'); return; }

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    git('commit', '-m', messageArg || `随记更新 ${stamp}`);
    try {
      git('push');
      console.log('✓ 已推送到 GitHub，GitHub Pages 将在约 1 分钟内更新');
      return;
    } catch {
      if (attempt === 3) throw new Error('推送连续 3 轮被拒（远端持续有新提交），请稍后重试或手动 git pull 处理');
      console.log(`推送被拒（远端又有新提交），合并后重试（第 ${attempt} 轮）…`);
    }
  }
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error('✗ 发布失败：' + e.message);
    if (e.stderr) console.error(String(e.stderr).trim());
    process.exit(1);
  }
}
module.exports = { main };
