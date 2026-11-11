#!/usr/bin/env node
'use strict';
/* 随记 · AI 库：管理 vault/04-AI（AI 相关的开源项目 / Skill / 工具 / 知识文章）
   用法：
     node tools/ai.js add project "AutoGen" --url https://github.com/... --creator Microsoft --why "想试试多智能体"
     node tools/ai.js add skill "某技能包" --why "..." --tags 写作
     node tools/ai.js add tool "某工具" --url https://... --tags 效率
     node tools/ai.js add article "某文章" --url https://... --creator 作者
     node tools/ai.js status "AutoGen" trying                # want | trying | kept | dropped（允许回退）
     node tools/ai.js remark "AutoGen" "跑通了示例，配置比想象中简单"
     node tools/ai.js link "AutoGen" "01-Journals/2026/11/2026-11-09"
     node tools/ai.js promote "AutoGen" 11-09 "01-Journals/2026/11/2026-11-09"
     node tools/ai.js show "AutoGen"
     node tools/ai.js list [--type project|skill|tool|article] [--status want|trying|kept|dropped]
   通用参数：--push 构建后直接推送；--date 对 add 为入库日期（默认今天）。
   说明：条目不是随记——标题就是名称，正文是感想时间流，不受随记三段式约束；
        入库存前先搜索确认名称/作者/链接，绝不编造。 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const LIST_DIR = '04-AI';
const FM_ORDER = ['added', 'type', 'title', 'url', 'creator', 'status', 'brief', 'why', 'tags'];
const TYPE_WORDS = {
  project: ['project', '项目'],
  skill: ['skill', '技能'],
  tool: ['tool', '工具'],
  article: ['article', '文章'],
};
const STATUS_WORDS = { want: '想试', trying: '在试', kept: '已用', dropped: '淘汰' };

function parseArgs(argv) {
  const args = { _: [], push: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--push') args.push = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i] ?? '';
    else args._.push(a);
  }
  return args;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayMD() { return today().slice(5); }

/* 名称 → 文件名安全段：非法字符与空白 → '-'，去首尾 '-' */
function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || '未命名';
}

/* 带特殊字符的值加引号（自定义解析器读取时会剥掉） */
function fmtValue(v) {
  const s = String(v);
  if (/[:#'"[\]{}|>&*!%@`,?]/.test(s) || /^\s|\s$/.test(s)) {
    return s.includes("'") ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function serializeFrontmatter(data) {
  const lines = ['---'];
  const emitted = new Set();
  for (const key of FM_ORDER) {
    if (data[key] === undefined || data[key] === null || data[key] === '') continue;
    emitted.add(key);
    if (Array.isArray(data[key])) {
      if (!data[key].length) continue;
      lines.push(`${key}:`);
      data[key].forEach(v => lines.push(`  - ${fmtValue(v)}`));
    } else {
      lines.push(`${key}: ${fmtValue(data[key])}`);
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (emitted.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}:`);
      value.forEach(v => lines.push(`  - ${fmtValue(v)}`));
    } else {
      lines.push(`${key}: ${fmtValue(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function listDir(config) {
  return path.join(lib.ROOT, config.vault || 'vault', LIST_DIR);
}

/* 墓碑登记：记录被有意删除/改名的 vault 相对路径，防止对账恢复（随载荷跨设备传播） */
function addTombstone(vaultDir, rel) {
  const f = path.join(vaultDir, '.tombstones');
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  if (!lines.includes(rel)) lines.push(rel);
  fs.writeFileSync(f, lines.join('\n') + '\n');
}

/* 按标题/文件名模糊匹配条目；重名或无匹配时列出候选 */
function findEntry(dir, query) {
  const q = String(query).trim().toLowerCase();
  const entries = fs.readdirSync(dir).filter(n => n.endsWith('.md')).map(name => {
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = lib.parseFrontmatter(text);
    return { name, file, text, data, body, title: String(data.title || name.replace(/\.md$/, '')) };
  });
  const score = e => {
    const base = e.name.replace(/\.md$/, '').replace(/^(Project|Skill|Tool|Article)-/, '').toLowerCase();
    const title = e.title.toLowerCase();
    if (title === q || base === q) return 2;
    if (title.includes(q) || base.includes(q)) return 1;
    return 0;
  };
  const matched = entries.map(e => ({ e, s: score(e) })).filter(x => x.s > 0);
  const exact = matched.filter(x => x.s === 2);
  const pool = exact.length ? exact : matched;
  if (!pool.length) {
    throw new Error(`没有找到「${query}」。现有条目：${entries.map(e => e.title).join('、') || '（空）'}`);
  }
  if (pool.length > 1) {
    throw new Error(`「${query}」匹配到多条：${pool.map(x => x.e.name).join('、')}。请说得更具体。`);
  }
  return pool[0].e;
}

function writeEntry(entry) {
  fs.writeFileSync(entry.file, serializeFrontmatter(entry.data) + entry.body.trim() + '\n');
}

/* 在 `## 感想` 段尾追加一条感想（无该段则创建） */
function appendRemark(body, dateMD, title, text) {
  const lines = body.split(/\r?\n/);
  const headingIdx = lines.findIndex(l => /^##\s+感想\s*$/.test(l.trim()));
  const block = [`### ${dateMD}${title ? ` · ${title}` : ''}`, text, ''];
  if (headingIdx >= 0) {
    let end = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    lines.splice(end, 0, ...block);
    return lines.join('\n');
  }
  const linkIdx = lines.findIndex(l => /^##\s+关联\s*$/.test(l.trim()));
  const section = ['## 感想', ...block];
  if (linkIdx >= 0) { lines.splice(linkIdx, 0, ...section); return lines.join('\n'); }
  return body.trim() + '\n\n' + section.join('\n') + '\n';
}

/* 在 `## 关联` 段尾追加一行（无该段则创建） */
function appendLink(body, label, target) {
  const lines = body.split(/\r?\n/);
  const headingIdx = lines.findIndex(l => /^##\s+关联\s*$/.test(l.trim()));
  const line = `- ${label}：[[${target}]]`;
  if (headingIdx >= 0) {
    let end = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    lines.splice(end, 0, line);
    return lines.join('\n');
  }
  return body.trim() + `\n\n## 关联\n${line}\n`;
}

/* 感想升格：在指定感想小节尾部追加「已成随记」标记 */
function markPromoted(body, dateMD, target) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => new RegExp(`^###\\s+${dateMD}\\b`).test(l.trim()));
  if (start < 0) throw new Error(`没有找到日期为 ${dateMD} 的感想小节`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) { end = i; break; }
  }
  lines.splice(end, 0, `→ 已成随记 [[${target}]]`, '');
  return lines.join('\n');
}

const TYPE_CHAR = { project: '项', skill: '技', tool: '具', article: '文' };

function brief(e) {
  const title = e.data.title || e.name.replace(/\.md$/, '');
  return `${e.name}  [${TYPE_CHAR[e.data.type] || '项'}·${STATUS_WORDS[e.data.status] || '想试'}]  ${title}`;
}

function normalizeType(word) {
  if (!word) return null;
  const w = String(word).trim().toLowerCase();
  for (const [type, aliases] of Object.entries(TYPE_WORDS)) {
    if (aliases.includes(w)) return type;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args._;
  const config = lib.loadConfig();
  const dir = listDir(config);
  fs.mkdirSync(dir, { recursive: true });

  const needBuild = ['add', 'status', 'remark', 'link', 'promote', 'rm', 'rename'].includes(command);
  let message = '';

  if (command === 'add') {
    const kindWord = rest[0];
    const kind = normalizeType(kindWord) || (args.type ? normalizeType(args.type) : null);
    if (!kind) throw new Error('用法：node tools/ai.js add project|skill|tool|article "名称" [--url --creator --why --tags]');
    const title = (normalizeType(kindWord) ? rest[1] : rest[0]) || '';
    if (!title) throw new Error('用法：node tools/ai.js add project|skill|tool|article "名称" [--url --creator --why --tags]');
    const dup = fs.readdirSync(dir).some(n => {
      if (!n.endsWith('.md')) return false;
      const { data } = lib.parseFrontmatter(fs.readFileSync(path.join(dir, n), 'utf8'));
      return String(data.title || '').trim() === title.trim();
    });
    if (dup) throw new Error(`「${title}」已在 AI 库里，用 status/remark 继续记录，不要重复添加。`);
    const kindName = kind[0].toUpperCase() + kind.slice(1);
    let name = `${kindName}-${sanitize(title)}.md`;
    let n = 2;
    while (fs.existsSync(path.join(dir, name))) name = `${kindName}-${sanitize(title)}-${n++}.md`;
    const data = {
      added: args.date || today(),
      type: kind,
      title,
      status: 'want',
    };
    if (args.url) data.url = args.url;
    if (args.creator) data.creator = args.creator;
    if (args.tags) data.tags = args.tags.split(',').map(s => s.trim()).filter(Boolean);
    if (args.why) data.why = args.why;
    if (args.brief) data.brief = args.brief;
    const why = args.why ? `> ${args.why}\n\n` : '';
    const body = `${why}## 感想\n\n## 关联\n`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, serializeFrontmatter(data) + body);
    message = `✓ 已入 AI 库：${name}（${TYPE_CHAR[kind]}·想试）`;

  } else if (command === 'status') {
    const [query, status] = rest;
    if (!['want', 'trying', 'kept', 'dropped'].includes(status)) throw new Error('状态只能是 want / trying / kept / dropped');
    const entry = findEntry(dir, query);
    entry.data.status = status;
    writeEntry(entry);
    message = `✓ 《${entry.data.title}》→ ${STATUS_WORDS[status]}`;
    if (status === 'dropped') message += '（记得用 remark 补一句淘汰原因，避免以后重复踩坑）';

  } else if (command === 'remark') {
    const [query, ...text] = rest;
    const entry = findEntry(dir, query);
    const dateMD = (args.date || today()).slice(5);
    entry.body = appendRemark(entry.body, dateMD, args.title || '', text.join(' '));
    writeEntry(entry);
    message = `✓ 已记感想：《${entry.data.title}》 ${dateMD}`;

  } else if (command === 'link') {
    const [query, target] = rest;
    const entry = findEntry(dir, query);
    entry.body = appendLink(entry.body, '相关随记', target);
    writeEntry(entry);
    message = `✓ 《${entry.data.title}》已关联 [[${target}]]`;

  } else if (command === 'promote') {
    const [query, dateMD, target] = rest;
    const entry = findEntry(dir, query);
    entry.body = markPromoted(entry.body, dateMD, target);
    writeEntry(entry);
    message = `✓ 《${entry.data.title}》 ${dateMD} 感想已标记升格为随记`;

  } else if (command === 'rm') {
    const entry = findEntry(dir, rest[0]);
    const rel = path.posix.join(LIST_DIR, path.basename(entry.file));
    const vaultDir = path.dirname(dir);
    addTombstone(vaultDir, rel);
    fs.unlinkSync(entry.file);
    message = `✓ 已移出 AI 库：《${entry.data.title}》（墓碑已登记，其它设备同步后同步删除）`;

  } else if (command === 'rename') {
    const entry = findEntry(dir, rest[0]);
    const newTitle = rest.slice(1).join(' ').trim();
    if (!newTitle) throw new Error('用法：node tools/ai.js rename "旧名称" "新名称"');
    const vaultDir = path.dirname(dir);
    const oldRel = path.posix.join(LIST_DIR, path.basename(entry.file));
    const kindName = (entry.data.type || 'project')[0].toUpperCase() + (entry.data.type || 'project').slice(1);
    let name = `${kindName}-${sanitize(newTitle)}.md`;
    let n = 2;
    while (fs.existsSync(path.join(dir, name)) && path.join(dir, name) !== entry.file) {
      name = `${kindName}-${sanitize(newTitle)}-${n++}.md`;
    }
    entry.data.title = newTitle;
    writeEntry(entry);
    fs.renameSync(entry.file, path.join(dir, name));
    if (oldRel !== path.posix.join(LIST_DIR, name)) addTombstone(vaultDir, oldRel);
    message = `✓ 已改名：《${newTitle}》 → ${name}${oldRel !== path.posix.join(LIST_DIR, name) ? '（旧名已登记墓碑）' : ''}`;

  } else if (command === 'show') {
    const entry = findEntry(dir, rest[0]);
    console.log(brief(entry));
    if (entry.data.url) console.log(`  ${entry.data.url}`);
    if (entry.data.creator) console.log(`  ${entry.data.creator}`);
    if (entry.data.why) console.log(`  ${entry.data.why}`);
    console.log('---');
    console.log(entry.body.trim());

  } else if (command === 'list') {
    const entries = fs.readdirSync(dir).filter(n => n.endsWith('.md')).map(name => {
      const { data } = lib.parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
      return { name, data };
    }).filter(e => (!args.type || (normalizeType(args.type) || args.type) === e.data.type)
      && (!args.status || (e.data.status || 'want') === args.status));
    if (!entries.length) console.log('（AI 库里还没有条目）');
    else entries.forEach(e => console.log(brief(e)));

  } else {
    console.log('用法见文件头注释：add / status / remark / link / promote / show / list');
    process.exit(command ? 1 : 0);
  }

  if (message) console.log(message);
  if (needBuild) {
    require('./build').main();
    if (args.push) require('./publish').main();
  }
}

try { main(); } catch (e) { console.error('✗ 失败：' + e.message); process.exit(1); }
