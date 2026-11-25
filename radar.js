/* 随记 · AI 雷达（2026-11-25 起）
   实时信号流：浏览器打开雷达视图时，直接从 GitHub / Hacker News / HuggingFace(镜像) 拉公开信号，
   每条按 FDE 三问过滤（有没有用 / 可信吗 / 能试吗）。不缓存、不入载荷，每次打开现拉。
   收进雷达：点信号卡上的「收进雷达」，复制一条命令（tool 调用需要 vault 落盘 + 加密构建，
   站点本身只读），说给随记 AI 就落盘进 vault/05-Radar，随下次构建加密进载荷。
   雷达条目 = 载荷里的 radar 数组，四态复用 AI 库（want/trying/kept/dropped）。 */
'use strict';

/* ---------- 配置 ---------- */
const RADAR_SOURCES = [
  { key: 'github', name: 'GitHub Trending', url: 'https://api.github.com/search/repositories',
    params: q => `?q=created:>${isoDaysAgo(7)}&sort=stars&order=desc&per_page=30` },
  { key: 'hn', name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search_by_date',
    params: () => '?tags=story&hitsPerPage=30' },
  { key: 'hf', name: 'HF Daily Papers', url: 'https://hf-mirror.com/api/daily_papers',
    params: () => '?limit=30' },
];

const RADAR_CHANNELS = [
  { g: '每天', items: [
    ['机器之心', 'https://www.jiqizhixin.com', '中文最快，扫标题就够'],
    ['量子位', 'https://www.qbitai.com', '中文 AI 动态，与机器之心互补'],
    ['r/LocalLLaMA', 'https://www.reddit.com/r/LocalLLaMA', '本地模型技巧/踩坑/评测'],
  ]},
  { g: '每周', items: [
    ['Import AI', 'https://importai.substack.com', 'Jack Clark 周报，一份覆盖全局'],
    ['Ahead of AI', 'https://magazine.sebastianraschka.com', 'Raschka 技术深度，图解多'],
    ['Simon Willison', 'https://simonwillison.net', 'LLM 工程师实战，密度最高'],
    ['The Rundown', 'https://www.therundown.ai', '每天一封邮件，5 分钟读完'],
    ['Lil\'Log', 'https://lilianweng.github.io', '研究综述，搞懂方向时查'],
    ['Papers With Code', 'https://paperswithcode.com', '按月看最高质量工作'],
  ]},
  { g: '官方', items: [
    ['Anthropic Engineering', 'https://www.anthropic.com/engineering', '工程实践一手，如 Building Agents'],
    ['OpenAI Blog', 'https://openai.com/news', '模型发布、产品、安全报告'],
    ['Google AI Blog', 'https://blog.google/technology/ai', 'Gemini 官方研究与实践'],
  ]},
];

const RADAR_CATS = ['模型', '工具', '实践', '论文', '行业'];
const RADAR_STATUS = { want: '想试', trying: '在试', kept: '已用', dropped: '淘汰' };
const CAT_TONE = { 模型: 'cat-model', 工具: 'cat-tool', 实践: 'cat-practice', 论文: 'cat-paper', 行业: 'cat-industry' };

/* ---------- 小工具 ---------- */
function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}
function agoText(tsSec) {
  if (!tsSec) return '';
  const d = (Date.now() / 1000) - tsSec;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} 分钟前`;
  if (d < 86400) return `${Math.round(d / 3600)} 小时前`;
  return `${Math.round(d / 86400)} 天前`;
}
/* 卡片可点词：为中文标题拆出 2-4 个关键词（去数字/短词/符号） */
function briefWords(text) {
  return String(text || '')
    .split(/[,，、;；\s]+/)
    .map(s => s.trim())
    .filter(s => s && !/^[\d.]+$/.test(s) && !/^[a-z]$/i.test(s))
    .slice(0, 3);
}

/* 雷达状态菜单里的「收进雷达」命令：网站只读，复制一句话交给随记 AI 落盘 */
function radarCommand(entry) {
  const cat = entry.category || '工具';
  const why = (entry.why || '').replace(/"/g, '');
  return `收进雷达：${entry.title}（${cat}）${entry.url ? ` --url ${entry.url}` : ''}${why ? ` --why "${why.slice(0, 80)}"` : ''}`;
}

/* ---------- 拉取信号 ---------- */
async function fetchRadarSignals() {
  const out = [];
  for (const src of RADAR_SOURCES) {
    try {
      const resp = await fetch(src.url + src.params(), { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = src.key === 'github' ? (data.items || []) : src.key === 'hn' ? (data.hits || []) : (Array.isArray(data) ? data : []);
      for (const it of items) {
        const s = parseSignal(src.key, it);
        if (s) out.push(s);
      }
    } catch (e) {
      console.warn('雷达拉取失败', src.name, e);
    }
  }
  /* 去重 + 按分数降序 */
  const seen = new Set();
  const uniq = [];
  for (const s of out.sort((a, b) => b.score - a.score)) {
    const k = `${s.source}:${s.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }
  return uniq.slice(0, 90);
}

function parseSignal(key, it) {
  try {
    if (key === 'github') {
      const name = it.full_name || '';
      if (!name) return null;
      return { id: `gh:${name}`, source: 'GitHub Trending', category: '工具', title: name,
        url: it.html_url || `https://github.com/${name}`, summary: it.description || '',
        why: '近一周新建的高星仓库，先看它解决什么问题、跟现有工具链有没有重叠',
        score: it.stargazers_count || 0, at: Date.now() / 1000 };
    }
    if (key === 'hn') {
      const title = it.title || '';
      if (!title) return null;
      return { id: `hn:${it.objectID}`, source: 'Hacker News', category: '行业', title,
        url: it.url || `https://news.ycombinator.com/item?id=${it.objectID}`, summary: '',
        why: 'HN 用户投票挑出来的，先看评论里在吵什么',
        score: it.points || 0, at: it.created_at_i || Date.now() / 1000 };
    }
    if (key === 'hf') {
      const paper = it.paper || {};
      const title = paper.title || it.title || '';
      if (!title) return null;
      return { id: `hf:${paper.id || title}`, source: 'HF Daily Papers', category: '论文', title,
        url: it.url || paper.url || '', summary: '',
        why: '社区点赞的当日新论文，先看摘要能不能直接变成可复现的做法',
        score: it.votes || 0, at: Date.now() / 1000 };
    }
  } catch { /* 单条坏了不影响其他 */ }
  return null;
}

/* ---------- 视图状态 ---------- */
const radarState = { cat: '', win: 'today', showSaved: false, signals: [], saved: [], loading: false };

function initRadar(state) {
  radarState.saved = Array.isArray(state.radar) ? state.radar : [];
  radarState.signals = [];
  radarState.cat = '';
  radarState.win = 'today';
  radarState.showSaved = false;
}

/* ---------- 筛选 ---------- */
function setupRadarFilters() {
  const chips = (container, options, key) => {
    const el = $(container);
    if (!el) return;
    el.replaceChildren(...options.map(([value, label]) => {
      const b = button(label, 'filter-chip', () => {
        radarState[key] = radarState[key] === value ? '' : value;
        renderRadar();
      });
      b.dataset.value = value;
      return b;
    }));
  };
  chips('radar-cat-filter', [['', '全部'], ...RADAR_CATS.map(c => [c, c])], 'cat');
  chips('radar-window-filter', [['today', '今天'], ['week', '本周'], ['all', '全部']], 'win');
  const savedChips = [['', '全部'], ...Object.entries(RADAR_STATUS).map(([v, l]) => [v, l])];
  chips('radar-saved-filter', savedChips, 'savedStatus');
  $('radar-saved-bar').hidden = !radarState.saved.length;
}

function filteredRadarSignals() {
  let items = radarState.signals;
  if (radarState.cat) items = items.filter(s => s.category === radarState.cat);
  if (radarState.win === 'today') items = items.filter(s => Date.now() / 1000 - s.at < 86400);
  else if (radarState.win === 'week') items = items.filter(s => Date.now() / 1000 - s.at < 7 * 86400);
  return items;
}

/* ---------- 渲染 ---------- */
function renderRadar() {
  const items = filteredRadarSignals();
  $('radar-count-line').textContent = radarState.loading ? '拉取中…' : `${items.length} 条信号 · 已收 ${radarState.saved.length}`;
  $('radar-stats').textContent = radarState.saved.length
    ? `已收进雷达 ${radarState.saved.length} 条（想试 ${radarState.saved.filter(e => e.status === 'want').length} · 在试 ${radarState.saved.filter(e => e.status === 'trying').length} · 已用 ${radarState.saved.filter(e => e.status === 'kept').length} · 淘汰 ${radarState.saved.filter(e => e.status === 'dropped').length}）`
    : '还没收进任何信号——值得跟的点「收进雷达」，试过真有用的放进 AI 库';
  $('radar-empty').hidden = items.length > 0;
  if (!items.length) {
    $('radar-empty-title').textContent = radarState.loading ? '正在拉信号…' : '这里没有这个信号。';
    $('radar-empty-text').textContent = radarState.loading ? '从三个公开源现拉，稍等一下。' : '换个筛选，或点「刷新 ↻」重拉。';
  }
  $('radar-feed').replaceChildren(...items.map(renderRadarCard));
  document.querySelectorAll('#radar-cat-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === radarState.cat));
  document.querySelectorAll('#radar-window-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === radarState.win));
  /* 已收条目区（可选）：显示收进雷达的精选 */
  const savedBox = $('radar-saved');
  if (savedBox) savedBox.replaceChildren(...radarState.saved.map(renderSavedRow));
  renderRadarChannels();
}

function renderRadarCard(sig) {
  const card = node('article', undefined, `list-card radar-card ${CAT_TONE[sig.category] || 'cat-tool'}`);
  card.id = `sig-${sig.id}`;
  /* 头部：分类 + 来源 + 时间 */
  const head = node('div', undefined, 'list-card-head');
  const catDot = node('span', sig.category, 'radar-cat');
  head.append(catDot, node('span', sig.source, 'list-kind'), node('span', agoText(sig.at), 'list-card-meta'));
  card.append(head);
  /* 标题 */
  const title = node('h3', undefined, 'list-card-title');
  title.append(node('span', sig.title, 'card-title'));
  card.append(title);
  /* 摘要 */
  if (sig.summary) card.append(node('p', sig.summary, 'radar-summary'));
  /* 为什么值得看（FDE 三问） */
  card.append(node('p', '◉ ' + sig.why, 'radar-why'));
  /* 关键词胶囊 */
  const words = briefWords(sig.title);
  if (words.length) {
    const tags = node('div', undefined, 'card-tags');
    words.forEach(w => tags.append(node('span', w, 'card-tag')));
    card.append(tags);
  }
  /* 链接 + 收进雷达 */
  const foot = node('div', undefined, 'radar-foot');
  if (sig.url && /^https?:\/\//i.test(sig.url)) {
    const a = node('a', '打开 ↗', 'read-more');
    a.href = sig.url; a.target = '_blank'; a.rel = 'noreferrer noopener';
    foot.append(a);
  }
  foot.append(button('收进雷达', 'read-more', () => openRadarKeepMenu(sig)));
  card.append(foot);
  return card;
}

function renderSavedRow(entry) {
  const row = node('div', undefined, 'radar-saved-row');
  const badge = node('span', RADAR_STATUS[entry.status] || '想试', `list-badge ai-${entry.status}`);
  const title = node('span', entry.title, 'radar-saved-title');
  row.append(badge, node('span', entry.category || '', 'list-kind'), title);
  if (entry.url && /^https?:\/\//i.test(entry.url)) {
    const a = node('a', '↗', 'read-more');
    a.href = entry.url; a.target = '_blank'; a.rel = 'noreferrer noopener';
    row.append(a);
  }
  return row;
}

function renderRadarChannels() {
  const box = $('radar-channels');
  box.hidden = false;
  box.replaceChildren();
  const title = node('div', undefined, 'radar-channels-title');
  title.append(node('p', '渠道目录', 'eyebrow'), node('h2', '自动信号不够，还有这些入口'));
  box.append(title);
  for (const group of RADAR_CHANNELS) {
    const sec = node('section', undefined, 'radar-chan-group');
    sec.append(node('h3', group.g === '每天' ? '每天扫一眼' : group.g === '每周' ? '每周订阅' : '官方一手', 'radar-chan-h'));
    const ul = node('ul');
    for (const [name, url, what] of group.items) {
      const li = node('li');
      const a = node('a', name);
      a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
      li.append(a, node('span', what, 'radar-chan-what'));
      ul.append(li);
    }
    sec.append(ul);
    box.append(sec);
  }
}

/* ---------- 收进雷达菜单 ---------- */
function openRadarKeepMenu(sig) {
  const menu = node('div', undefined, 'ai-status-menu radar-menu');
  menu.setAttribute('role', 'menu');
  menu.append(node('p', '网站是加密只读的，选中会复制一句话给随记 AI，说出去就收进雷达（落盘 + 加密推送）：', 'ai-status-menu-hint'));
  const command = radarCommand(sig);
  const item = button(`收进雷达：${sig.title}`, 'ai-status-item', () => {
    try { navigator.clipboard.writeText(command); toast(`已复制：${command}`); }
    catch { toast(`请复制这句话：${command}`); }
    menu.remove();
  });
  item.append(node('span', `会存成 vault/05-Radar 条目（${sig.category}）`, 'ai-status-item-desc'));
  menu.append(item);
  const cancel = button('取消', 'ai-status-item', () => menu.remove());
  menu.append(cancel);
  document.body.append(menu);
  /* 简单定位到卡片附近 */
  const r = document.querySelector(`#sig-${CSS.escape(sig.id)}`)?.getBoundingClientRect();
  if (r) { menu.style.position = 'fixed'; menu.style.left = `${Math.max(8, r.left)}px`; menu.style.top = `${Math.min(window.innerHeight - 120, r.bottom + 8)}px`; }
  const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } };
  document.addEventListener('pointerdown', close);
}

/* ---------- 刷新 ---------- */
async function refreshRadar() {
  if (radarState.loading) return;
  radarState.loading = true;
  $('radar-fetched').textContent = '正在拉取…';
  $('radar-source-line').textContent = '';
  renderRadar();
  try {
    radarState.signals = await fetchRadarSignals();
    $('radar-fetched').textContent = `信号拉取于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    const srcs = [...new Set(radarState.signals.map(s => s.source))];
    $('radar-source-line').textContent = `来源：${srcs.join(' / ') || '都没拉通'}`;
  } catch (e) {
    console.warn('雷达刷新失败', e);
    $('radar-fetched').textContent = '拉取失败';
    $('radar-source-line').textContent = '网络不通时，下面渠道目录也能帮你找到入口';
  }
  radarState.loading = false;
  renderRadar();
}

/* 暴露给 app.js */
window.radarModule = { initRadar, setupRadarFilters, renderRadar, refreshRadar };
