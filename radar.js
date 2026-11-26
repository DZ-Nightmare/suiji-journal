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
const radarState = { cat: '', win: 'today', showSaved: false, signals: [], saved: [], loading: false, q: '' };

/* ---------- AI 点评（2026-11-26）----------
   雷达卡片「为什么值得看」原先是写死的模板句；有 MIMO key 时拉完信号后
   自动对 top 信号生成一句真点评。结果存 localStorage（按信号 id），
   已点评的不重复烧额度；无 key 时静默显示模板句。 */
const RADAR_AI_KEY = 'suiji-radar-ai';
const RADAR_AI_TOPN = 8;
let radarAiCache = {};
function radarAiLoad() {
  try { radarAiCache = JSON.parse(localStorage.getItem(RADAR_AI_KEY) || '{}'); } catch { radarAiCache = {}; }
}
function radarAiSave() {
  try { localStorage.setItem(RADAR_AI_KEY, JSON.stringify(radarAiCache)); } catch {}
}
const radarAiWhyOf = (sig) => radarAiCache[sig.id] || '';
let radarAiAnnotating = false;

async function annotateRadar() {
  if (radarAiAnnotating) return;
  if (!window.aiModule) return;
  window.aiModule.loadKey?.();
  /* aiState.key 不导出，用 localStorage 判断 */
  let key = '';
  try { key = localStorage.getItem('suiji-mimo-key') || ''; } catch {}
  if (!key) return;
  const items = filteredRadarSignals().slice(0, RADAR_AI_TOPN).filter((s) => !radarAiCache[s.id]);
  if (!items.length) return;
  radarAiAnnotating = true;
  $('radar-source-line').textContent = `MIMO 正在点评 ${items.length} 条信号…`;
  for (const sig of items) {
    try {
      const prompt = [
        { role: 'system', content: '你是 AI 雷达的点评员。给一条开源项目/HN 热帖/论文信号写一句中文点评，30 字以内，回答它值得关注的理由，不要客套话，不用"值得关注"开头。' },
        { role: 'user', content: `来源：${sig.source}\n标题：${sig.title}\n${sig.summary ? `摘要：${sig.summary}` : ''}` },
      ];
      const line = await window.aiModule.mimoOnce(prompt);
      if (line) {
        radarAiCache[sig.id] = line;
        radarAiSave();
        renderRadar();
      }
    } catch {
      // 单条失败不中断；下一条继续
      continue;
    }
  }
  radarAiAnnotating = false;
  const srcs = [...new Set(radarState.signals.map((s) => s.source))];
  $('radar-source-line').textContent = `来源：${srcs.join(' / ') || '都没拉通'}`;
}

/* ---------- AI 简报 / 频段周报（2026-11-26）----------
   FDE 阅读节奏：先简报（今天该看什么）后深挖（单条追问）再复盘（频段周报）。
   简报按「日期」存 localStorage，同一天不重复烧额度；
   周报按「频段+日期」存，同频段同一天不重复。 */
const RADAR_BRIEF_KEY = 'suiji-radar-brief';
const RADAR_WEEK_KEY = 'suiji-radar-week';
let radarBriefBusy = false;
let radarWeekBusy = false;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function briefCache() {
  try { return JSON.parse(localStorage.getItem(RADAR_BRIEF_KEY) || 'null'); } catch { return null; }
}
function weekCache() {
  try { return JSON.parse(localStorage.getItem(RADAR_WEEK_KEY) || '{}'); } catch { return {}; }
}
function hasMimoKey() {
  try { return !!(localStorage.getItem('suiji-mimo-key') || ''); } catch { return false; }
}

/* 打字机：逐字出现 + 光标闪烁；reduced-motion 时一次到位 */
async function typewriter(el, text, speed = 18) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('typing');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = text;
    el.classList.remove('typing');
    return;
  }
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    if (i % 3 === 0) await new Promise((r) => setTimeout(r, speed));
  }
  el.classList.remove('typing');
}

/* 简报：top 信号总结成「今天值得关注什么」 */
async function generateBrief() {
  if (radarBriefBusy) return;
  if (!hasMimoKey()) { toast('先在 AI 点评里配 MIMO key'); return; }
  const cached = briefCache();
  if (cached && cached.date === todayStr()) {
    showBrief(cached.text, false);
    return;
  }
  radarBriefBusy = true;
  const btn = $('radar-brief-btn');
  btn.textContent = '✧ 正在生成简报…';
  btn.classList.add('charging');
  const items = filteredRadarSignals().slice(0, 15);
  if (!items.length) { radarBriefBusy = false; btn.textContent = '✧ 生成今日简报'; btn.classList.remove('charging'); return; }
  const lines = items.map((s) => `- [${s.source}] ${s.title}${s.summary ? `：${s.summary.slice(0, 80)}` : ''}`).join('\n');
  try {
    const text = await window.aiModule.mimoOnce([
      { role: 'system', content: '你是 AI 雷达的简报员。根据信号列表写一份中文早报，120-160 字：先一句总体判断，再挑 3-5 条最值得关注的各用一句说清它是什么、为什么重要。不要编号列表，用连贯段落。' },
      { role: 'user', content: lines },
    ]);
    if (text) {
      localStorage.setItem(RADAR_BRIEF_KEY, JSON.stringify({ date: todayStr(), text }));
      showBrief(text, true);
    }
  } catch (e) {
    toast(`简报生成失败：${e.message}`);
  }
  radarBriefBusy = false;
  btn.textContent = '✧ 生成今日简报';
  btn.classList.remove('charging');
}

function showBrief(text, animate) {
  const box = $('radar-brief');
  const body = $('radar-brief-body');
  box.hidden = false;
  $('radar-brief-date').textContent = todayStr();
  if (animate) typewriter(body, text);
  else body.textContent = text;
  box.classList.add('brief-in');
  setTimeout(() => box.classList.remove('brief-in'), 500);
}

/* 频段周报：选中某频段时的总结 */
async function generateWeekReport() {
  if (radarWeekBusy) return;
  const cat = radarState.cat;
  if (!cat) return;
  if (!hasMimoKey()) { toast('先在 AI 点评里配 MIMO key'); return; }
  const cached = weekCache();
  if (cached[cat] && cached[cat].date === todayStr()) {
    showBrief(cached[cat].text, false);
    $('radar-brief-title').textContent = `${cat}频段周报`;
    return;
  }
  radarWeekBusy = true;
  const btn = $('radar-week-btn');
  btn.textContent = `✧ 正在总结${cat}…`;
  btn.classList.add('charging');
  const items = filteredRadarSignals().slice(0, 20);
  try {
    const text = await window.aiModule.mimoOnce([
      { role: 'system', content: '你是 AI 雷达的复盘员。根据信号列表写一份频段周报，100-140 字：这个领域最近在发生什么、有什么趋势、哪几条最值得动手试。连贯段落，不编号。' },
      { role: 'user', content: items.map((s) => `- [${s.source}] ${s.title}${s.summary ? `：${s.summary.slice(0, 80)}` : ''}`).join('\n') },
    ]);
    if (text) {
      const w = weekCache();
      w[cat] = { date: todayStr(), text };
      localStorage.setItem(RADAR_WEEK_KEY, JSON.stringify(w));
      $('radar-brief-title').textContent = `${cat}频段周报`;
      showBrief(text, true);
    }
  } catch (e) {
    toast(`周报生成失败：${e.message}`);
  }
  radarWeekBusy = false;
  btn.textContent = '✧ 总结此频段';
  btn.classList.remove('charging');
}

function initRadar(state) {
  radarState.saved = Array.isArray(state.radar) ? state.radar : [];
  radarState.signals = [];
  radarState.cat = '';
  radarState.win = 'today';
  radarState.showSaved = false;
  radarAiLoad();
}

/* ---------- 筛选 ---------- */
function setupRadarFilters() {
  const chips = (container, options, key) => {
    const el = $(container);
    if (!el) return;
    el.replaceChildren(...options.map(([value, label]) => {
      const b = button(label, 'radar-seg-btn', () => {
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
  if (radarState.q) {
    const q = radarState.q.toLocaleLowerCase();
    items = items.filter(s => [s.title, s.summary, radarAiWhyOf(s), s.source].join('\n').toLocaleLowerCase().includes(q));
  }
  return items;
}

/* ---------- 渲染 ---------- */
/* 数字波纹：Hero 三个统计数从 0 滚到目标值（rAF，600ms easeOut） */
function rollRadarStats() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const targets = [
    ['radar-live-count', radarState.signals.length],
    ['radar-live-sources', new Set(radarState.signals.map((s) => s.source)).size],
    ['radar-live-saved', radarState.saved.length],
  ];
  for (const [id, to] of targets) {
    const el = $(id);
    if (!el) continue;
    const from = Number(el.textContent) || 0;
    if (from === to) continue;
    const t0 = performance.now();
    const dur = 600;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function renderRadar() {
  const items = filteredRadarSignals();
  $('radar-count-line').textContent = radarState.loading ? '拉取中…' : `${items.length} 条信号 · 已收 ${radarState.saved.length}`;
  $('radar-live-count').textContent = items.length;
  $('radar-live-sources').textContent = new Set(items.map(s => s.source)).size;
  $('radar-live-saved').textContent = radarState.saved.length;
  $('radar-empty').hidden = items.length > 0;
  if (!items.length) {
    $('radar-empty-title').textContent = radarState.loading ? '正在拉信号…' : '这里没有这个信号。';
    $('radar-empty-text').textContent = radarState.loading ? '从三个公开源现拉，稍等一下。' : '换个频段，或点「⟳ 刷新」重拉。';
  }
  $('radar-feed').replaceChildren(...items.map(renderRadarCard));
  /* 搜获扫描 + 错峰淡入：新卡片进视口时扫一道光、前 12 张错 18ms 淡入；
     reduced-motion 时全跳过。 */
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const feedCards = document.querySelectorAll('.radar-card');
    feedCards.forEach((c, i) => {
      c.classList.add('stagger-in');
      c.style.animationDelay = `${Math.min(i, 12) * 18}ms`;
      if (!c.dataset.scanObserved) {
        c.dataset.scanObserved = '1';
        const io = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add('scan-in'); io.disconnect(); }
          });
        }, { threshold: 0.4 });
        io.observe(c);
      }
    });
  }
  /* 数字波纹：Hero 统计数从 0 滚到目标 */
  rollRadarStats();
  document.querySelectorAll('#radar-cat-filter .radar-seg-btn').forEach(el => el.classList.toggle('active', el.dataset.value === radarState.cat));
  document.querySelectorAll('#radar-window-filter .radar-seg-btn').forEach(el => el.classList.toggle('active', el.dataset.value === radarState.win));
  document.querySelectorAll('#radar-saved-filter .radar-seg-btn').forEach(el => el.classList.toggle('active', el.dataset.value === (radarState.savedStatus || '')));
  /* 周报按钮只在选中具体频段时出现；简报缓存今天已有则直接展示 */
  $('radar-week-btn').hidden = !radarState.cat;
  if (radarState.cat) $('radar-week-btn').textContent = `✧ 总结${radarState.cat}频段`;
  const bc = briefCache();
  if (bc && bc.date === todayStr()) {
    $('radar-brief-title').textContent = '今日简报';
    showBrief(bc.text, false);
  }
  renderRadarChannels();
}

function renderRadarCard(sig) {
  const card = node('article', undefined, `radar-card ${CAT_TONE[sig.category] || 'cat-tool'}`);
  card.id = `sig-${sig.id}`;
  /* 头部：分类徽章 + 来源 · 时间 */
  const head = node('div', undefined, 'radar-card-head');
  const badge = node('span', sig.category, `radar-cat-badge ${CAT_TONE[sig.category] || 'cat-tool'}`);
  head.append(badge, node('span', `${sig.source} · ${agoText(sig.at)}`, 'radar-card-meta'));
  card.append(head);
  /* 标题（点卡片开详情，不再直接跳原文；链接挪到详情抽屉里） */
  const title = node('h3', undefined, 'radar-card-title');
  const t = node('button', sig.title, 'radar-card-title-link');
  t.type = 'button';
  t.title = '点开详情';
  t.addEventListener('click', () => openRadarDetail(sig));
  title.append(t);
  card.append(title);
  /* 摘要 */
  if (sig.summary) card.append(node('p', sig.summary, 'radar-card-summary'));
  /* 底部：为什么值得看（AI 点评优先，模板句兜底）+ 收进雷达 */
  const foot = node('div', undefined, 'radar-card-foot');
  const aiWhy = radarAiWhyOf(sig);
  const whyP = node('p', aiWhy || sig.why, aiWhy ? 'radar-card-why radar-why-ai' : 'radar-card-why');
  whyP.title = aiWhy ? 'MIMO 点评' : '为什么值得看';
  foot.append(whyP);
  const ask = button('问 AI', 'radar-ask-btn', () => openRadarAsk(sig, card));
  const keep = button('收进雷达', 'radar-keep-btn', () => openRadarKeepMenu(sig));
  foot.append(ask, keep);
  card.append(foot);
  return card;
}

/* ---------- 详情抽屉（功能：看全简介 + 深挖单条）----------
   点卡片标题（或任何空白处）打开；「锁定目标」隐喻，右侧滑入，不打断信号流。
   抽屉里：全文摘要 + 为什么值得看 + 打开原文 + 问 AI + 收进雷达。 */
let radarDetailSig = null;
function openRadarDetail(sig) {
  radarDetailSig = sig;
  const d = $('radar-detail');
  $('radar-detail-cat').textContent = sig.category;
  $('radar-detail-cat').className = `radar-cat-badge ${CAT_TONE[sig.category] || 'cat-tool'}`;
  $('radar-detail-source').textContent = `${sig.source} · ${agoText(sig.at)}`;
  $('radar-detail-title').textContent = sig.title;
  const link = $('radar-detail-link');
  if (sig.url && /^https?:\/\//i.test(sig.url)) { link.href = sig.url; link.hidden = false; }
  else link.hidden = true;
  $('radar-detail-summary').textContent = sig.summary || '（无摘要）';
  $('radar-detail-summary').hidden = !sig.summary;
  $('radar-detail-why').textContent = radarAiWhyOf(sig) || sig.why;
  $('radar-detail-ai').hidden = true;
  $('radar-detail-ai').textContent = '';
  d.hidden = false;
  d.classList.remove('detail-in');
  void d.offsetWidth;
  d.classList.add('detail-in');
}
function closeRadarDetail() {
  $('radar-detail').hidden = true;
  radarDetailSig = null;
}

/* 抽屉里的「问 AI」：流式回答写进抽屉 */
async function askInDetail() {
  if (!radarDetailSig) return;
  if (!hasMimoKey()) { toast('先在 AI 点评里配 MIMO key'); return; }
  const sig = radarDetailSig;
  const box = $('radar-detail-ai');
  box.hidden = false;
  box.classList.add('typing');
  box.textContent = '';
  try {
    const response = await fetch(`${'https://api.xiaomimimo.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('suiji-mimo-key') || ''}` },
      body: JSON.stringify({ model: 'mimo-v2.6-pro', messages: [
        { role: 'system', content: '你是 AI 雷达的解说员。用中文回答，100 字以内，说清它是什么、为什么值得关注、值不值得花时间试，不客套。' },
        { role: 'user', content: `来源：${sig.source}\n标题：${sig.title}\n${sig.summary ? `摘要：${sig.summary}` : ''}` },
      ], stream: true }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await streamText(response, (piece) => { box.textContent += piece; });
  } catch (e) {
    box.textContent = `出错了：${e.message}`;
  }
  box.classList.remove('typing');
}

/* ---------- 卡片内追问（功能2）----------
   点「问 AI」：卡片锁定呼吸，浮层从卡片位置展开（不居中打断视线），
   流式回复打字机。不做缓存（每次真问，追问本来就是深挖）。 */
async function openRadarAsk(sig, card) {
  if (!hasMimoKey()) { toast('先在 AI 点评里配 MIMO key'); return; }
  const old = document.querySelector('.radar-ask-pop');
  if (old) old.remove();
  card.classList.add('card-locked');
  const pop = node('div', undefined, 'radar-ask-pop');
  pop.innerHTML = `
    <div class="radar-ask-head"><span class="radar-ask-glyph">◉</span><b>${sig.source} · ${sig.title.slice(0, 40)}</b><button class="radar-ask-close">✕</button></div>
    <div class="radar-ask-msgs"><div class="radar-ask-q">这条是什么？和我们有什么关系？</div><div class="radar-ask-a typing"><span class="radar-ask-cursor"></span></div></div>
    <div class="radar-ask-input-row"><input class="radar-ask-input" placeholder="继续追问…"><button class="radar-ask-send">发送</button></div>`;
  document.body.appendChild(pop);
  const r = card.getBoundingClientRect();
  pop.style.left = `${Math.max(8, r.left)}px`;
  pop.style.top = `${Math.min(window.innerHeight - 320, r.bottom + 8)}px`;
  pop.classList.add('pop-in');
  const msgs = pop.querySelector('.radar-ask-msgs');
  const aEl = pop.querySelector('.radar-ask-a');
  const input = pop.querySelector('.radar-ask-input');
  const sendBtn = pop.querySelector('.radar-ask-send');
  pop.querySelector('.radar-ask-close').addEventListener('click', () => { pop.remove(); card.classList.remove('card-locked'); });

  const ask = async (q) => {
    if (!q.trim()) return;
    aEl.classList.add('typing');
    aEl.textContent = '';
    try {
      const response = await fetch(`${'https://api.xiaomimimo.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('suiji-mimo-key') || ''}` },
        body: JSON.stringify({ model: 'mimo-v2.6-pro', messages: [
          { role: 'system', content: '你是 AI 雷达的解说员。用中文回答，60 字以内，直接说它是什么、为什么值得关注，不客套。' },
          { role: 'user', content: `来源：${sig.source}\n标题：${sig.title}\n${sig.summary ? `摘要：${sig.summary}` : ''}\n\n用户问：${q}` },
        ], stream: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await streamText(response, (piece) => { aEl.textContent += piece; msgs.scrollTop = msgs.scrollHeight; });
    } catch (e) {
      aEl.textContent = `出错了：${e.message}`;
    }
    aEl.classList.remove('typing');
  };
  sendBtn.addEventListener('click', () => { ask(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(input.value); input.value = ''; } });
  ask('这条信号是什么？和我们有什么关系？');
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
  title.append(node('p', 'CHANNEL DIRECTORY', 'radar-eyebrow'), node('h2', '信号之外，这些入口每天值得扫一眼'));
  box.append(title);
  for (const group of RADAR_CHANNELS) {
    const sec = node('section', undefined, 'radar-chan-group');
    const h = node('h3', group.g === '每天' ? '每天扫一眼' : group.g === '每周' ? '每周订阅' : '官方一手', 'radar-chan-h');
    const freq = node('span', group.g.toUpperCase(), 'radar-chan-freq');
    sec.append(h, freq);
    const ul = node('ul', undefined, 'radar-chan-list');
    for (const [name, url, what] of group.items) {
      const li = node('li');
      const a = node('a', name, 'radar-chan-link');
      a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
      const arrow = node('span', '↗', 'radar-chan-arrow');
      li.append(a, arrow, node('span', what, 'radar-chan-what'));
      ul.append(li);
    }
    sec.append(ul);
    box.append(sec);
  }
}

/* ---------- 收进雷达菜单 ---------- */
function openRadarKeepMenu(sig) {
  const menu = node('div', undefined, 'radar-menu');
  menu.setAttribute('role', 'menu');
  menu.append(node('p', '网站是加密只读的，选中会复制一句话给随记 AI，说出去就收进雷达（落盘 + 加密推送）：', 'radar-menu-hint'));
  const command = radarCommand(sig);
  const item = button(`收进雷达：${sig.title}`, 'radar-menu-item', () => {
    try { navigator.clipboard.writeText(command); toast(`已复制：${command}`); }
    catch { toast(`请复制这句话：${command}`); }
    menu.remove();
  });
  item.append(node('span', `会存成 vault/05-Radar 条目（${sig.category}）`, 'radar-menu-desc'));
  menu.append(item);
  const cancel = button('取消', 'radar-menu-item', () => menu.remove());
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
  $('radar-fetched').textContent = '正在接入信号…';
  $('radar-source-line').textContent = '';
  /* 扫描等待态：Hero 底一条往返扫描条替代文字 */
  $('radar-scanbar').hidden = false;
  renderRadar();
  try {
    radarState.signals = await fetchRadarSignals();
    $('radar-fetched').textContent = `信号接入 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    const srcs = [...new Set(radarState.signals.map(s => s.source))];
    $('radar-source-line').textContent = `来源：${srcs.join(' / ') || '都没拉通'}`;
  } catch (e) {
    console.warn('雷达刷新失败', e);
    $('radar-fetched').textContent = '接入失败';
    $('radar-source-line').textContent = '网络不通时，渠道目录也能帮你找到入口';
  }
  radarState.loading = false;
  $('radar-scanbar').hidden = true;
  renderRadar();
  annotateRadar();
}

/* ---------- 交互式背景：鼠标视差（2026-11-25）----------
   鼠标在雷达视图内移动时：
   - Hero 里的雷达示波器跟着轻微偏移（视差，最大 8px）
   - 每张信号卡按与鼠标的距离产生轻微倾斜（最大 1.6deg），形成「朝向光标」的场
   纯 transform + rAF 节流，不碰布局；reduced-motion 时完全禁用。 */
let radarParallax = { on: false, mx: 0, my: 0, raf: 0 };
function radarParallaxFrame() {
  const scope = document.querySelector('#radar-scope');
  if (scope) {
    scope.style.transform = `translate(${radarParallax.mx * 8}px, ${radarParallax.my * 8}px)`;
  }
  for (const card of document.querySelectorAll('.radar-card')) {
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = (radarParallax.mx * window.innerWidth - cx) / Math.max(window.innerWidth, 1);
    const dy = (radarParallax.my * window.innerHeight - cy) / Math.max(window.innerHeight, 1);
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) { card.style.transform = ''; continue; }
    card.style.transform = `perspective(700px) rotateX(${(-dy * 1.6).toFixed(2)}deg) rotateY(${(dx * 1.6).toFixed(2)}deg)`;
  }
  radarParallax.raf = 0;
}
function radarParallaxMove(e) {
  radarParallax.mx = e.clientX / Math.max(window.innerWidth, 1);
  radarParallax.my = e.clientY / Math.max(window.innerHeight, 1);
  if (!radarParallax.raf) radarParallax.raf = requestAnimationFrame(radarParallaxFrame);
}
function radarParallaxEnable(on) {
  if (radarParallax.on === on) return;
  radarParallax.on = on;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const hero = document.querySelector('#radar-hero');
  if (!hero) return;
  if (on) hero.addEventListener('mousemove', radarParallaxMove);
  else {
    hero.removeEventListener('mousemove', radarParallaxMove);
    const scope = document.querySelector('#radar-scope');
    if (scope) scope.style.transform = '';
    for (const card of document.querySelectorAll('.radar-card')) card.style.transform = '';
  }
}
/* 视图进入时开、离开时关（app.js 的 setView 调） */
function radarParallaxAttach() {
  const view = document.querySelector('#view-radar');
  if (!view) return;
  const observer = new MutationObserver(() => {
    radarParallaxEnable(!view.hidden);
  });
  observer.observe(view, { attributes: true, attributeFilter: ['hidden'] });
  radarParallaxEnable(!view.hidden);
}
document.addEventListener('DOMContentLoaded', radarParallaxAttach);
document.addEventListener('DOMContentLoaded', () => {
  $('radar-brief-btn')?.addEventListener('click', generateBrief);
  $('radar-week-btn')?.addEventListener('click', generateWeekReport);
  /* 搜索：输入即过滤（防抖 200ms） */
  const searchInput = $('radar-search');
  let searchTimer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { radarState.q = searchInput.value.trim(); renderRadar(); }, 200);
  });
  $('radar-detail-close')?.addEventListener('click', closeRadarDetail);
  $('radar-detail-ask')?.addEventListener('click', askInDetail);
  $('radar-detail-keep')?.addEventListener('click', () => { if (radarDetailSig) openRadarKeepMenu(radarDetailSig); });
});

/* 暴露给 app.js */
window.radarModule = { initRadar, setupRadarFilters, renderRadar, refreshRadar, radarParallaxEnable, annotateRadar, generateBrief, generateWeekReport };
