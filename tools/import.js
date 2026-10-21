#!/usr/bin/env node
'use strict';
/* 随记 · 导入：把外部文件（图片/音频/文档/随笔草稿）收进 vault
   用法：
     node tools/import.js 随笔草稿.md 图1.webp 图2.png            # md 入库 + 附件入库并改写引用
     node tools/import.js --date 2026-10-20 --tags 随笔,工作 草稿.md
     node tools/import.js --collection --title "处世哲学 · 顺势而为" 草稿.md
     node tools/import.js --text "直接把随笔文本贴进来" --date 2026-10-20
   参数：
     --date YYYY-MM-DD   记录日期（缺省取 frontmatter 或今天）
     --tags 逗号分隔      追加标签
     --source 来源        照片/录音/对话/网页/文字…
     --title 标题         卡片标题
     --collection         作为沉淀专题（02-Collection）
     --push               导入后构建并推送 GitHub
*/
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function parseArgs(argv) {
  const args = { files: [], tags: null, date: null, source: null, title: null, collection: false, push: false, text: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--tags') args.tags = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--title') args.title = argv[++i];
    else if (a === '--collection') args.collection = true;
    else if (a === '--push') args.push = true;
    else if (a === '--text') args.text = argv[++i];
    else args.files.push(a);
  }
  return args;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function slugify(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\s]+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = lib.loadConfig();
  const vaultDir = path.join(lib.ROOT, config.vault || 'vault');
  const attachDir = path.join(vaultDir, 'Attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const renameMap = new Map();   // 旧文件名 -> 新文件名
  const notes = [];

  for (const file of args.files) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) throw new Error(`文件不存在：${file}`);
    const ext = path.extname(full).toLowerCase();
    if (ext === '.md' || ext === '.txt') {
      notes.push({ name: path.basename(full), text: fs.readFileSync(full, 'utf8') });
    } else {
      const date = args.date || today();
      const newName = `${date}-${slugify(path.basename(full))}${ext}`;
      fs.copyFileSync(full, path.join(attachDir, newName));
      renameMap.set(path.basename(full), newName);
      console.log(`✓ 附件 → vault/Attachments/${newName}`);
    }
  }
  if (args.text) notes.push({ name: 'inline.md', text: args.text });
  if (!notes.length && !renameMap.size) throw new Error('没有可导入的内容（传入 md/图片等文件，或用 --text）');

  for (const note of notes) {
    let text = note.text;
    // 改写附件引用为 vault 内新文件名（先按同名映射）
    for (const [oldName, newName] of renameMap) {
      text = text.split(oldName).join(newName);
    }
    // 引用名与导入文件名对不上时（如正文写 [[Attachments/测试图.png]] 但文件叫 photo.png），
    // 把尚未匹配的引用按顺序对应到尚未被引用的导入附件
    const importedNew = [...renameMap.values()];
    const refs = [...text.matchAll(/\[\[Attachments\/([^\]|]+)/g)].map(m => m[1].trim());
    const pool = importedNew.filter(n => !refs.includes(n));
    let cursor = 0;
    for (const ref of refs) {
      const exists = importedNew.includes(ref) || fs.existsSync(path.join(attachDir, ref));
      if (!exists && pool[cursor]) text = text.split(`Attachments/${ref}`).join(`Attachments/${pool[cursor++]}`);
    }
    // 补齐 frontmatter
    const { data, body } = lib.parseFrontmatter(text);
    const date = args.date || (data.date ? String(data.date) : today());
    const tags = [...new Set([...(Array.isArray(data.tags) ? data.tags.map(String) : data.tags ? [String(data.tags)] : []), ...(args.tags || [])])];
    const title = args.title || (data.title ? String(data.title) : '');
    const source = args.source || (data.source ? String(data.source) : '');
    const fmLines = ['---', `date: ${date}`];
    if (title) fmLines.push(`title: ${title}`);
    if (tags.length) { fmLines.push('tags:'); tags.forEach(t => fmLines.push(`  - ${t}`)); }
    if (source) fmLines.push(`source: ${source}`);
    fmLines.push('---', '');

    let target;
    if (args.collection) {
      const name = (title || '未命名沉淀').replace(/[<>:"/\\|?*]/g, '-');
      target = path.join(vaultDir, '02-Collection', `${name}.md`);
    } else {
      const dir = path.join(vaultDir, '01-Journals', date.slice(0, 4), date.slice(5, 7));
      fs.mkdirSync(dir, { recursive: true });
      target = path.join(dir, `${date}.md`);
      let n = 2;
      while (fs.existsSync(target)) target = path.join(dir, `${date}-${n++}.md`);
    }
    fs.writeFileSync(target, fmLines.join('\n') + body.trim() + '\n');
    console.log(`✓ 随记 → ${path.relative(vaultDir, target)}`);
  }

  require('./build').main();
  if (args.push) require('./publish').main();
}

try { main(); } catch (e) { console.error('✗ 导入失败：' + e.message); process.exit(1); }
