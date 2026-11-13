'use strict';
/* 随记 · 前端逻辑：解锁 / 时间轴 / 筛选 / 日历 / 阅读器 / 附件解密 */
const $ = id => document.getElementById(id);
const decoder = new TextDecoder();
const VIEWER_VER = '1794542525682';  // 构建时自动替换为时间戳，防止 viewer.html 旧缓存
const encoder = new TextEncoder();

const state = {
  key: null, notes: [], lists: [], hasLists: false, ai: [], hasAI: false, media: new Map(), urls: new Set(),
  session: 0, currentAnchor: null, currentDetail: null, detailDepth: 0, view: 'notes',
  ascending: false, calendar: '', listSort: 'added', aiSort: 'added',
  lastActive: Date.now(),
  filter: { q: '', tag: '', topic: '', month: '', day: '', images: false },
  listFilter: { type: '', status: '', tag: '' },
  aiFilter: { type: '', status: '', tag: '' },
};

function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(text, cls, action) {
  const el = node('button', text, cls);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}
function b64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function monthLabel(value) { return `${value.slice(0, 4)} 年 ${Number(value.slice(5, 7))} 月`; }
function dateLabel(note) {
  return note.date.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, (_, y, m, d) => `${y} 年 ${Number(m)} 月 ${Number(d)} 日`);
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function resetFilters() {
  state.filter = { q: '', tag: '', topic: '', month: '', day: '', images: false };
  $('search').value = '';
  render();
}

/* ---------- 解锁 / 锁定 ---------- */
async function unlock(event) {
  event.preventDefault();
  const password = $('password').value;
  const submit = $('unlock-submit');
  submit.disabled = true;
  submit.textContent = '正在打开…';
  $('unlock-message').classList.remove('error');
  $('unlock-message').textContent = '正在解锁这本随记…';
  try {
    if (!window.crypto?.subtle) throw new Error('此浏览器需要通过 HTTPS 打开网页。');
    const response = await fetch('journal.enc.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('暂时无法读取随记，请稍后重试。');
    const data = await response.json();
    if (data.version !== 1 || data.iterations !== 600000) throw new Error('暂不支持这个随记文件版本。');
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(data.salt), iterations: data.iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64(data.nonce), additionalData: encoder.encode('journal:v1') },
        key, b64(data.ciphertext));
    } catch {
      throw new Error('密码不对，或文件未完整加载。请检查后再试。');
    }
    const payload = JSON.parse(decoder.decode(plain));
    if (!Array.isArray(payload.notes)) throw new Error('随记文件格式有误。');
    state.key = key;
    offerPasswordSave(password);
    state.notes = payload.notes;
    // 书影清单：payload.lists 不存在（旧构建数据）时隐藏入口；空数组照常展示
    state.hasLists = Array.isArray(payload.lists);
    state.lists = state.hasLists ? payload.lists : [];
    // AI 库：payload.ai 不存在（旧构建数据）时隐藏入口；空数组照常展示
    state.hasAI = Array.isArray(payload.ai);
    state.ai = state.hasAI ? payload.ai : [];
    state.session++;
    state.lastActive = Date.now();
    state.calendar = state.notes.length
      ? state.notes.map(n => n.date.slice(0, 7)).sort().at(-1)
      : new Date().toISOString().slice(0, 7);
    $('password').value = '';
    $('password').type = 'password';
    $('show-password').textContent = '显示';
    $('unlock-message').textContent = '内容与附件均已加密，仅在当前浏览器解锁。';
    $('updated-at').textContent = payload.built_at
      ? `页面更新于 ${payload.built_at.slice(0, 16).replace('T', ' ')}（北京时间）` : '';
    populate();
    resetFilters();
    revealJournal();
  } catch (error) {
    $('unlock-message').textContent = error.message || '打开失败，请重试。';
    $('unlock-message').classList.add('error');
  } finally {
    submit.disabled = false;
    submit.replaceChildren(document.createTextNode('打开我的随记 '), node('span', '↗'));
  }
}

/* ---------- 浏览器密码管理器（Edge/Chrome）----------
   表单是纯前端解锁、从不真正提交，密码管理器识别不到登录行为；
   用 Credential Management API 主动保存，并支持静默自动填充。 */
function offerPasswordSave(password) {
  try {
    if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.store) return;
    const cred = new PasswordCredential({ id: '随记', name: '随记 · 查看密码', password });
    navigator.credentials.store(cred).catch(() => { });
  } catch { }
}

async function prefillFromPasswordManager() {
  try {
    if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.get) return;
    // silent：只在用户开了「自动登录」时静默填入，绝不弹窗打扰
    const cred = await navigator.credentials.get({ password: true, mediation: 'silent' });
    if (cred?.password && !$('password').value) {
      $('password').value = cred.password;
      $('unlock-message').textContent = '已从浏览器密码管理器填入，点「打开我的随记」即可。';
    }
  } catch { }
}
prefillFromPasswordManager();

function revealJournal() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    $('lock-screen').hidden = true;
    $('lock-screen').classList.remove('leaving');
    $('journal').hidden = false;
    $('journal').classList.add('entering');
    setTimeout(() => $('journal').classList.remove('entering'), 700);
    document.body.classList.remove('book-opening');
    const hash = location.hash.slice(1);
    if (hash.startsWith('card-')) openNote(hash, true);
    else if (hash.startsWith('list-') && state.hasLists) openList(hash, true);
    else if (hash.startsWith('ai-') && state.hasAI) openAI(hash, true);
    window.scrollTo(0, 0);
  };
  // 书本插画在手机端隐藏：不可见时跳过翻书，直接登场（避免白等）
  const bookWrap = document.querySelector('.book-wrap');
  const bookVisible = !!bookWrap && bookWrap.getClientRects().length > 0;
  if (reduce || !bookVisible) { finish(); return; }
  // 封面翻开（.9s）→ 锁屏淡出（.4s）→ 随记登场
  document.body.classList.add('book-opening');
  setTimeout(() => {
    $('lock-screen').classList.add('leaving');
    setTimeout(finish, 420);
  }, 950);
}

function lockJournal() {
  state.session++;
  state.key = null;
  state.notes = [];
  state.lists = [];
  state.ai = [];
  state.currentAnchor = null;
  state.currentDetail = null;
  state.detailDepth = 0;
  state.media.clear();
  state.urls.forEach(url => URL.revokeObjectURL(url));
  state.urls.clear();
  ['reader', 'lightbox'].forEach(id => $(id).close());
  ['timeline', 'month-nav', 'topic-nav', 'filter-tags', 'calendar-grid', 'reader-body', 'reader-attachments', 'reader-tags', 'reader-links', 'lists-grid', 'lists-type-filter', 'lists-status-filter', 'lists-tag-filter', 'ai-grid', 'ai-type-filter', 'ai-status-filter', 'ai-tag-filter'].forEach(id => $(id).replaceChildren());
  ['reader-title', 'reader-id', 'reader-date', 'reader-meta', 'updated-at', 'start-date', 'calendar-title', 'visible-count', 'footer-count', 'lists-count-line', 'lists-stats', 'ai-count-line', 'ai-stats'].forEach(id => { $(id).textContent = ''; });
  ['total-count', 'day-count', 'nav-count', 'list-count', 'ai-count'].forEach(id => { $(id).textContent = '0'; });
  $('reader-meta').hidden = true;
  $('reader-links').hidden = true;
  setView('notes', true);
  $('lightbox-image').removeAttribute('src');
  $('search').value = '';
  $('password').value = '';
  $('journal').hidden = true;
  $('lock-screen').hidden = false;
  $('lock-screen').classList.remove('leaving');
  $('journal').classList.remove('entering');
  document.body.classList.remove('book-opening');
  $('toast').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo(0, 0);
  $('password').focus();
}

/* ---------- 渲染 ---------- */
function populate() {
  $('nav-count').textContent = state.notes.length;
  $('total-count').textContent = state.notes.length;
  $('day-count').textContent = new Set(state.notes.map(n => n.date.slice(0, 10))).size;
  const dates = state.notes.map(n => n.date.slice(0, 10)).sort();
  $('start-date').textContent = dates.length ? `始于 ${dates[0].replaceAll('-', '.')}` : '等待第一条随记';
  $('footer-count').textContent = `${state.notes.length} 个被留住的瞬间`;

  const months = [...new Set(state.notes.map(n => n.date.slice(0, 7)))].sort().reverse();
  $('month-nav').replaceChildren(...months.map(month => {
    const el = button(monthLabel(month), 'month-button', () => {
      state.filter.month = state.filter.month === month ? '' : month;
      state.filter.day = '';
      state.calendar = month;
      render();
    });
    el.dataset.month = month;
    el.append(node('span', state.notes.filter(n => n.date.startsWith(month)).length));
    return el;
  }));

  const topics = [...new Set(state.notes.flatMap(n => n.topics))];
  $('topic-nav').replaceChildren(...topics.map(topic => {
    const el = button(topic, 'topic-button', () => {
      state.filter.topic = state.filter.topic === topic ? '' : topic;
      render();
    });
    el.dataset.topic = topic;
    return el;
  }));

  const tags = [...new Set(state.notes.flatMap(n => n.tags))].slice(0, 12);
  const all = button('全部', 'filter-chip', () => { state.filter.tag = ''; state.filter.topic = ''; render(); });
  all.dataset.tag = '';
  $('filter-tags').replaceChildren(all, ...tags.map(tag => {
    const el = button(tag, 'filter-chip', () => {
      state.filter.tag = state.filter.tag === tag ? '' : tag;
      render();
    });
    el.dataset.tag = tag;
    return el;
  }));

  $('random-note').disabled = !state.notes.length;
  $('revisit-button').disabled = !state.notes.length;

  // 手机端：侧栏隐藏后提供月份选择与「偶遇旧念头」入口
  if (!$('mobile-month')) {
    const btn = button('全部月份', 'mobile-month', openMonthSheet);
    btn.id = 'mobile-month';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', '按月份筛选随记');
    $('sort-button').before(btn);

    const backdrop = node('div', undefined, 'sheet-backdrop');
    backdrop.id = 'month-sheet';
    backdrop.hidden = true;
    const sheet = node('div', undefined, 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '按月份筛选随记');
    sheet.append(node('p', '按月份回看', 'sheet-title'), node('div', undefined, 'sheet-list'),
      button('完成', 'sheet-done', closeMonthSheet));
    backdrop.append(sheet);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeMonthSheet(); });
    document.body.append(backdrop);

    const revisit = button('✧ 偶遇一条旧念头 ↗', 'mobile-revisit', randomNote);
    revisit.id = 'mobile-revisit';
    document.querySelector('.hero-meta').after(revisit);
  }
  const monthList = [{ value: '', label: '全部月份', count: state.notes.length },
    ...months.map(m => ({
      value: m, label: `${m.slice(0, 4)}.${m.slice(5, 7)}`,
      count: state.notes.filter(n => n.date.startsWith(m)).length,
    }))];
  const listEl = document.querySelector('#month-sheet .sheet-list');
  listEl.replaceChildren(...monthList.map(item => {
    const opt = button('', 'sheet-option', () => {
      state.filter.month = item.value;
      state.filter.day = '';
      if (item.value) state.calendar = item.value;
      closeMonthSheet();
      render();
    });
    opt.dataset.month = item.value;
    opt.classList.toggle('active', state.filter.month === item.value);
    opt.append(node('span', item.label), node('span', String(item.count), 'sheet-count'), node('span', '✓', 'sheet-check'));
    return opt;
  }));

  $('list-nav').hidden = !state.hasLists;
  $('list-count').textContent = state.lists.length;
  $('ai-nav').hidden = !state.hasAI;
  $('ai-count').textContent = state.ai.length;
  $('view-switch').hidden = !state.hasLists && !state.hasAI;
  setupListFilters();
  setupAIFilters();
}

/* ---------- 视图切换（时间轴 / 书影 / AI 库） ---------- */
function setView(view, silent) {
  state.view = view;
  $('view-notes').hidden = view !== 'notes';
  $('view-lists').hidden = view !== 'lists';
  $('view-ai').hidden = view !== 'ai';
  $('breadcrumb-page').textContent = view === 'lists' ? '书影' : view === 'ai' ? 'AI 库' : '时间轴';
  $('all-notes').classList.toggle('active', view === 'notes');
  $('list-nav').classList.toggle('active', view === 'lists');
  $('ai-nav').classList.toggle('active', view === 'ai');
  // 移动端视图切换控件同步
  [['mobile-view-notes', 'notes'], ['mobile-view-lists', 'lists'], ['mobile-view-ai', 'ai']].forEach(([id, v]) => {
    const btn = $(id);
    btn.classList.toggle('active', view === v);
    btn.setAttribute('aria-selected', String(view === v));
  });
  $('search').placeholder = view === 'lists' ? '找一本书，一部电影…' : view === 'ai' ? '找一个项目、工具、文章…' : '找一段话，或一个念头…';
  if (silent) return;
  if (view === 'lists') renderLists();
  else if (view === 'ai') renderAI();
  else render();
}

/* ---------- 书影清单渲染 ---------- */
function listStatusText(entry) {
  const labels = entry.type === 'movie'
    ? { want: '想看', doing: '在看', done: '看完' }
    : { want: '想读', doing: '在读', done: '读完' };
  return labels[entry.status] || labels.want;
}

function listMetaText(entry) {
  const bits = [];
  if (entry.creator) bits.push(entry.creator + (entry.year ? ` · ${entry.year}` : ''));
  else if (entry.year) bits.push(entry.year);
  if (entry.progress) bits.push(entry.progress);
  if (entry.rating) bits.push('★'.repeat(Math.min(5, Math.max(1, entry.rating))));
  return bits.join(' · ');
}

function listExcerpt(entry) {
  const clean = s => s
    .replace(/→ 已成随记.*/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^>\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_, p, l) => (l ? l.slice(1) : p.split('/').at(-1).replace(/\.[^.]+$/, '')))
    .trim().slice(0, 80);
  const last = entry.remarks.length ? entry.remarks[entry.remarks.length - 1].text : '';
  if (last.trim()) return clean(last);
  const line = entry.body.split(/\r?\n/).find(l => l.trim() && !/^#{1,3}\s/.test(l.trim()));
  return clean(line || '');
}

function setupListFilters() {
  const chips = (container, options, key) => {
    $(container).replaceChildren(...options.map(([value, label]) => {
      const el = button(label, 'filter-chip', () => {
        state.listFilter[key] = state.listFilter[key] === value ? '' : value;
        renderLists();
      });
      el.dataset.value = value;
      return el;
    }));
  };
  chips('lists-type-filter', [['', '全部'], ['book', '书'], ['movie', '影']], 'type');
  chips('lists-status-filter', [['', '全部'], ['want', '想'], ['doing', '在读'], ['done', '读完']], 'status');
  const tags = [...new Set(state.lists.flatMap(n => n.tags))];
  $('lists-tag-filter').replaceChildren(...tags.map(tag => {
    const el = button('# ' + tag, 'filter-chip', () => {
      state.listFilter.tag = state.listFilter.tag === tag ? '' : tag;
      renderLists();
    });
    el.dataset.value = tag;
    return el;
  }));
}

function filteredLists() {
  const f = state.listFilter;
  const q = state.filter.q.trim().toLocaleLowerCase();
  const out = state.lists.filter(n =>
    (!q || [n.title, n.creator, n.body, ...n.tags].join('\n').toLocaleLowerCase().includes(q)) &&
    (!f.type || n.type === f.type) &&
    (!f.status || n.status === f.status) &&
    (!f.tag || n.tags.includes(f.tag)));
  const sorters = {
    added: (a, b) => b.added.localeCompare(a.added) || b.id.localeCompare(a.id),
    priority: (a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.added.localeCompare(a.added),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.added.localeCompare(a.added),
  };
  return out.sort(sorters[state.listSort] || sorters.added);
}

function renderLists() {
  const lists = filteredLists();
  $('lists-grid').replaceChildren(...lists.map(renderListCard));
  $('lists-count-line').textContent = `${lists.length} 条`;
  const count = s => state.lists.filter(n => n.status === s).length;
  $('lists-stats').textContent = `想读/想看 ${count('want')} · 在读/在看 ${count('doing')} · 读完/看完 ${count('done')}`;
  const empty = $('lists-empty');
  empty.hidden = lists.length > 0;
  if (!state.lists.length) {
    $('lists-empty-title').textContent = '清单还空着。';
    $('lists-empty-text').textContent = '对任意 AI 说一句「想读《…》」或「想看《…》」，第一条就会出现在这里。';
  } else {
    $('lists-empty-title').textContent = '这里没有这个条目。';
    $('lists-empty-text').textContent = '换个筛选或关键词，回到全部看看。';
  }
  document.querySelectorAll('#lists-type-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.listFilter.type));
  document.querySelectorAll('#lists-status-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.listFilter.status));
  document.querySelectorAll('#lists-tag-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.listFilter.tag));
  const sortLabels = { added: '最近添加 ↓', priority: '优先级 ↑', rating: '评分 ↓' };
  $('lists-sort').textContent = sortLabels[state.listSort] || sortLabels.added;
}

function renderListCard(entry) {
  const card = node('article', undefined, 'list-card');
  card.id = entry.anchor;

  const head = node('div', undefined, 'list-card-head');
  const badge = node('button', listStatusText(entry), `list-badge list-${entry.status} ai-status-btn`);
  badge.type = 'button';
  badge.title = '点击修改状态';
  badge.addEventListener('click', e => { e.stopPropagation(); openListStatusMenu(entry, badge); });
  head.append(badge,
    node('span', entry.type === 'movie' ? '影' : '书', 'list-kind'));
  card.append(head);

  const cover = entry.attachments.find(a => a.mime.startsWith('image/'));
  const remoteCover = cover ? null : (entry.body.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/) || [])[1];
  if (cover || remoteCover) {
    const imageButton = button('', 'list-cover', () => cover ? showImage(cover) : showRemoteImage(remoteCover, `${entry.title}的封面`));
    imageButton.setAttribute('aria-label', `查看「${entry.title}」的封面`);
    const img = node('img');
    img.alt = `${entry.title}的封面`;
    img.loading = 'lazy';
    imageButton.append(img);
    card.append(imageButton);
    if (remoteCover) {
      img.src = remoteCover;
    } else {
      loadMedia(cover)
        .then(url => { if (img.isConnected && state.key) img.src = url; })
        .catch(() => {
          if (state.key) imageButton.replaceChildren(node('div', '封面暂时未能加载。', 'image-loading'));
        });
    }
  }

  const title = node('h3', undefined, 'list-card-title');
  title.append(button(entry.title, 'card-title', () => openList(entry.anchor)));
  card.append(title);
  const meta = listMetaText(entry);
  if (meta) card.append(node('p', meta, 'list-card-meta'));
  const excerpt = listExcerpt(entry);
  if (excerpt) card.append(node('p', excerpt, 'card-excerpt'));

  const tags = node('div', undefined, 'card-tags');
  entry.tags.slice(0, 3).forEach(tag => tags.append(button('# ' + tag, 'card-tag', () => {
    state.listFilter.tag = state.listFilter.tag === tag ? '' : tag;
    renderLists();
  })));
  card.append(tags);
  card.append(button('翻开条目 ↗', 'read-more', () => openList(entry.anchor)));
  return card;
}

function filteredNotes() {
  const f = state.filter;
  const q = f.q.trim().toLocaleLowerCase();
  return state.notes
    .filter(n =>
      (!q || [n.title, n.body, ...n.tags, ...n.topics].join('\n').toLocaleLowerCase().includes(q)) &&
      (!f.tag || n.tags.includes(f.tag)) &&
      (!f.topic || n.topics.includes(f.topic)) &&
      (!f.month || n.date.startsWith(f.month)) &&
      (!f.day || n.date.startsWith(f.day)) &&
      (!f.images || n.attachments.some(a => a.mime.startsWith('image/'))))
    .sort((a, b) => (state.ascending ? 1 : -1) * (a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
}

function render() {
  const notes = filteredNotes();
  $('timeline').replaceChildren();
  let previous = '';
  for (const note of notes) {
    const month = note.date.slice(0, 7);
    if (month !== previous) {
      $('timeline').append(node('h3', monthLabel(month), 'month-heading'));
      previous = month;
    }
    $('timeline').append(renderCard(note));
  }
  $('visible-count').textContent = `${notes.length} 篇`;
  $('empty-state').hidden = notes.length > 0;
  $('timeline-end').hidden = notes.length === 0;
  const emptyTitle = $('empty-state').querySelector('h3');
  const emptyText = $('empty-state').querySelector('p');
  if (!state.notes.length) {
    emptyTitle.textContent = '随记还空着。';
    emptyText.textContent = '对任意 AI 说一句「记一条随记」，第一条就会出现在这里。';
  } else {
    emptyTitle.textContent = '这里还没有这个念头。';
    emptyText.textContent = '换个关键词，或回到全部随记看看。';
  }

  const f = state.filter;
  const labels = [
    f.month && monthLabel(f.month),
    f.day && `${Number(f.day.slice(8, 10))} 日`,
    f.topic && `主题：${f.topic}`,
    f.tag && `#${f.tag}`,
    f.q && `搜索：${f.q}`,
  ].filter(Boolean);
  $('active-filter').hidden = !labels.length;
  $('active-filter').firstElementChild.textContent = labels.join(' · ');

  document.querySelectorAll('.month-button').forEach(el => el.classList.toggle('active', el.dataset.month === f.month));
  document.querySelectorAll('.topic-button').forEach(el => el.classList.toggle('active', el.dataset.topic === f.topic));
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.toggle('active', el.dataset.tag === f.tag));
  $('image-filter').setAttribute('aria-pressed', String(f.images));
  const mobileMonth = $('mobile-month');
  if (mobileMonth) {
    mobileMonth.textContent = (f.month ? `${f.month.slice(0, 4)}.${f.month.slice(5, 7)}` : '全部月份') + ' ▾';
    document.querySelectorAll('#month-sheet .sheet-option').forEach(el => el.classList.toggle('active', el.dataset.month === f.month));
  }
  $('sort-button').textContent = state.ascending ? '最早在前 ↑' : '最新在前 ↓';
  renderCalendar();
}

function renderCard(note) {
  const entry = node('article', undefined, 'timeline-entry');
  entry.id = note.anchor;

  const stamp = node('div', undefined, 'date-stamp');
  const time = node('time');
  time.dateTime = note.date;
  time.append(node('strong', note.date.slice(8, 10)), node('small', note.weekday));
  stamp.append(time);

  const card = node('div', undefined, 'entry-card');
  const main = node('div', undefined, 'card-main');
  const meta = node('div', undefined, 'entry-meta');
  const source = node('span');
  const label = note.tags.find(t => !t.startsWith('topic/')) || note.topics[0] || '随想';
  source.append(node('i', undefined, 'meta-dot'), document.createTextNode(label));
  meta.append(source, node('span', note.id));

  const title = node('h3');
  title.append(button(note.title, 'card-title', () => openNote(note.anchor)));
  main.append(meta, title);

  if (note.quote) main.append(node('blockquote', note.quote, 'card-quote'));
  const excerpt = (note.thought || '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_, p, l) => (l ? l.slice(1) : p.split('/').at(-1)))
    .trim();
  if (excerpt) main.append(node('p', excerpt, 'card-excerpt'));
  card.append(main);

  const image = note.attachments.find(a => a.mime.startsWith('image/'));
  if (image) {
    const imageButton = button('', 'card-picture', () => showImage(image));
    imageButton.setAttribute('aria-label', `查看「${note.title}」的配图`);
    const img = node('img');
    img.alt = `${note.title}的原始配图`;
    img.loading = 'lazy';
    imageButton.append(img);
    card.append(imageButton);
    loadMedia(image)
      .then(url => { if (img.isConnected && state.key) img.src = url; })
      .catch(() => {
        if (state.key) imageButton.replaceChildren(node('div', '配图暂时未能加载，点开全文后可重试。', 'image-loading'));
      });
  }

  const bottom = node('div', undefined, 'card-bottom');
  const tags = node('div', undefined, 'card-tags');
  note.tags.slice(0, 3).forEach(tag => tags.append(button('# ' + tag, 'card-tag', () => { state.filter.tag = tag; render(); })));
  if (!tags.childNodes.length) tags.append(node('span', note.topics[0] || '随想', 'card-tag'));
  bottom.append(tags, button('阅读全文 ↗', 'read-more', () => openNote(note.anchor)));
  card.append(bottom);

  entry.append(stamp, card);
  return entry;
}

function renderCalendar() {
  const [year, month] = state.calendar.split('-').map(Number);
  $('calendar-title').textContent = monthLabel(state.calendar);
  const first = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const grid = [];
  for (let i = 0; i < first; i++) grid.push(node('span'));
  for (let day = 1; day <= days; day++) {
    const date = `${state.calendar}-${String(day).padStart(2, '0')}`;
    const has = state.notes.some(n => n.date.startsWith(date));
    if (has) {
      const el = button(String(day), 'has-note', () => {
        state.filter.month = state.calendar;
        state.filter.day = state.filter.day === date ? '' : date;
        render();
      });
      el.setAttribute('aria-label', `${year}年${month}月${day}日，有随记`);
      el.classList.toggle('selected', state.filter.day === date);
      grid.push(el);
    } else {
      grid.push(node('span', day));
    }
  }
  $('calendar-grid').replaceChildren(...grid);
  const months = state.notes.map(n => n.date.slice(0, 7)).sort();
  $('calendar-prev').disabled = !months.length || state.calendar <= months[0];
  $('calendar-next').disabled = !months.length || state.calendar >= months.at(-1);
}

function moveCalendar(delta) {
  const [y, m] = state.calendar.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  state.calendar = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
}

/* ---------- AI 库渲染 ---------- */
const AI_TYPE_LABEL = { project: '项目', skill: '技能', tool: '工具', article: '文章' };
const AI_STATUS_LABEL = { want: '想试', trying: '在试', kept: '已用', dropped: '淘汰' };
const AI_STATUS_DESC = { want: '收藏了，还没动手', trying: '正在试用', kept: '沉淀进工具箱', dropped: '试过不合适' };

function aiStatusText(entry) {
  return AI_STATUS_LABEL[entry.status] || AI_STATUS_LABEL.want;
}

function aiMetaText(entry) {
  const added = `入库存于 ${Number(entry.added.slice(5, 7))} 月 ${Number(entry.added.slice(8, 10))} 日`;
  return added;
}

function aiExcerpt(entry) {
  const clean = s => s
    .replace(/→ 已成随记.*/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^>\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_, p, l) => (l ? l.slice(1) : p.split('/').at(-1).replace(/\.[^.]+$/, '')))
    .trim().slice(0, 80);
  const last = entry.remarks.length ? entry.remarks[entry.remarks.length - 1].text : '';
  if (last.trim()) return clean(last);
  if (entry.why) return clean(entry.why);
  const line = entry.body.split(/\r?\n/).find(l => l.trim() && !/^#{1,3}\s/.test(l.trim()));
  return clean(line || '');
}

/* 卡片封面位置的「简洁描述」：brief（2-4 个关键词，逗号/空格分隔）。
   没有 brief 时兜底取 why 的前几个词；完整描述只在详情页。 */
function aiBriefWords(entry) {
  const words = (entry.brief || entry.why || '')
    .split(/[,，、;；\s]+/)
    .map(s => s.trim())
    .filter(s => s && !/^[\d.]+$/.test(s))
    .slice(0, 4);
  return words;
}

function setupAIFilters() {
  const chips = (container, options, key) => {
    $(container).replaceChildren(...options.map(([value, label]) => {
      const el = button(label, 'filter-chip', () => {
        state.aiFilter[key] = state.aiFilter[key] === value ? '' : value;
        renderAI();
      });
      el.dataset.value = value;
      return el;
    }));
  };
  chips('ai-type-filter', [['', '全部'], ['project', '项目'], ['skill', '技能'], ['tool', '工具'], ['article', '文章']], 'type');
  chips('ai-status-filter', [['', '全部'], ['want', '想试'], ['trying', '在试'], ['kept', '已用'], ['dropped', '淘汰']], 'status');
  const tags = [...new Set(state.ai.flatMap(n => n.tags))];
  $('ai-tag-filter').replaceChildren(...tags.map(tag => {
    const el = button('# ' + tag, 'filter-chip', () => {
      state.aiFilter.tag = state.aiFilter.tag === tag ? '' : tag;
      renderAI();
    });
    el.dataset.value = tag;
    return el;
  }));
}

function filteredAI() {
  const f = state.aiFilter;
  const q = state.filter.q.trim().toLocaleLowerCase();
  const out = state.ai.filter(n =>
    (!q || [n.title, n.creator, n.url, n.why, n.body, ...n.tags].join('\n').toLocaleLowerCase().includes(q)) &&
    (!f.type || n.type === f.type) &&
    (!f.status || n.status === f.status) &&
    (!f.tag || n.tags.includes(f.tag)));
  const sorters = {
    added: (a, b) => b.added.localeCompare(a.added) || b.id.localeCompare(a.id),
    type: (a, b) => a.type.localeCompare(b.type) || b.added.localeCompare(a.added),
  };
  return out.sort(sorters[state.aiSort] || sorters.added);
}

function renderAI() {
  const items = filteredAI();
  $('ai-grid').replaceChildren(...items.map(renderAICard));
  $('ai-count-line').textContent = `${items.length} 条`;
  const count = s => state.ai.filter(n => n.status === s).length;
  $('ai-stats').textContent = `想试 ${count('want')} · 在试 ${count('trying')} · 已用 ${count('kept')} · 淘汰 ${count('dropped')}`;
  const empty = $('ai-empty');
  empty.hidden = items.length > 0;
  if (!state.ai.length) {
    $('ai-empty-title').textContent = 'AI 库还空着。';
    $('ai-empty-text').textContent = '对任意 AI 说一句「记下这个项目/Skill/工具」，第一条就会出现在这里。';
  } else {
    $('ai-empty-title').textContent = '这里没有这个条目。';
    $('ai-empty-text').textContent = '换个筛选或关键词，回到全部看看。';
  }
  document.querySelectorAll('#ai-type-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.aiFilter.type));
  document.querySelectorAll('#ai-status-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.aiFilter.status));
  document.querySelectorAll('#ai-tag-filter .filter-chip').forEach(el => el.classList.toggle('active', el.dataset.value === state.aiFilter.tag));
  const sortLabels = { added: '最近添加 ↓', type: '按类型 ↓' };
  $('ai-sort').textContent = sortLabels[state.aiSort] || sortLabels.added;
}

function renderAICard(entry) {
  const card = node('article', undefined, 'list-card ai-card');
  card.id = entry.anchor;

  // 1) 标题在最上：身份锚点，第一眼读到「这是什么」
  const title = node('h3', undefined, 'list-card-title');
  title.append(button(entry.title, 'card-title', () => openAI(entry.anchor)));
  card.append(title);

  // 2) 状态徽章（可点弹状态菜单）+ 类型小字：跟在身份后面补充属性
  const head = node('div', undefined, 'list-card-head');
  const badge = node('button', aiStatusText(entry), `list-badge ai-${entry.status} ai-status-btn`);
  badge.type = 'button';
  badge.title = '点击修改状态';
  badge.addEventListener('click', e => { e.stopPropagation(); openAIStatusMenu(entry, badge); });
  head.append(badge, node('span', AI_TYPE_LABEL[entry.type] || '项目', 'list-kind'));
  card.append(head);

  // 3) 封面位关键词胶囊：几个词点明主题（详细描述只在详情页）
  const briefWords = aiBriefWords(entry);
  if (briefWords.length) {
    const briefBox = node('div', undefined, 'ai-brief');
    briefBox.setAttribute('aria-label', '关键词');
    briefWords.forEach(w => briefBox.append(node('span', w, 'ai-brief-chip')));
    card.append(briefBox);
  }

  // 4) 入库存日期，一行安静小字
  const meta = aiMetaText(entry);
  if (meta) card.append(node('p', meta, 'list-card-meta'));

  // 5) 可点击分类 tag（点击筛选）
  const tags = node('div', undefined, 'card-tags');
  entry.tags.slice(0, 3).forEach(tag => tags.append(button('# ' + tag, 'card-tag', () => {
    state.aiFilter.tag = state.aiFilter.tag === tag ? '' : tag;
    renderAI();
  })));
  card.append(tags);

  // 6) 链接胶囊（可点开新标签）
  if (entry.url && /^https?:\/\//i.test(entry.url)) {
    const a = node('a', entry.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), 'ai-url');
    a.href = entry.url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    card.append(a);
  }
  card.append(button('翻开条目 ↗', 'read-more', () => openAI(entry.anchor)));
  return card;
}

/* 状态菜单：网页是只读加密站（vault 在本机、载荷全加密），状态无法在浏览器内直接落盘。
   诚实且可用的交互：点状态弹菜单，选一个状态 → 复制一句话给随记 AI，说出去就改好了。 */
/* 状态菜单通用外壳：labels 形如 { value: [标签, 说明] }，commandFor 生成复制指令 */
function openStatusMenu(badge, labels, current, commandFor) {
  const menu = node('div', undefined, 'ai-status-menu');
  menu.setAttribute('role', 'menu');
  menu.append(node('p', '修改状态？站点是加密只读的，选中会复制一句话给随记 AI 完成落盘：', 'ai-status-menu-hint'));
  for (const [value, [label, desc]] of Object.entries(labels)) {
    const item = button(`${label}${current === value ? ' · 当前' : ''}`, 'ai-status-item', () => {
      const command = commandFor(label);
      try {
        navigator.clipboard.writeText(command);
        toast(`已复制：${command}`);
      } catch {
        toast(`请复制这句话：${command}`);
      }
      menu.remove();
    });
    if (current === value) item.classList.add('current');
    if (desc) item.append(node('span', desc, 'ai-status-item-desc'));
    menu.append(item);
  }
  menu.append(button('取消', 'ai-status-cancel', () => menu.remove()));
  document.body.append(menu);
  const rect = badge.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
  menu.style.top = (rect.bottom + 6) + 'px';
  // 点击菜单外关闭
  setTimeout(() => {
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

const AI_STATUS_MENU = Object.fromEntries(Object.entries(AI_STATUS_LABEL).map(([v, label]) => [v, [label, AI_STATUS_DESC[v]]]));
function openAIStatusMenu(entry, badge) {
  openStatusMenu(badge, AI_STATUS_MENU, entry.status,
    label => `随记：把 AI 库的《${entry.title}》标记为「${label}」`);
}

function openListStatusMenu(entry, badge) {
  const isMovie = entry.type === 'movie';
  const labels = {
    want: [isMovie ? '想看' : '想读', '收藏了，还没开始'],
    doing: [isMovie ? '在看' : '在读', '正在进行中'],
    done: [isMovie ? '看完' : '读完', '完成了'],
  };
  openStatusMenu(badge, labels, entry.status,
    label => `随记：把书影清单的《${entry.title}》标记为「${label}」`);
}

function openAI(anchor, fromHash) {
  const entry = state.ai.find(n => n.anchor === anchor);
  if (!entry) return;
  state.currentAnchor = anchor;
  state.currentDetail = { kind: 'ai', anchor };
  $('reader-date').textContent = `入库存于 ${entry.added}`;
  $('reader-id').textContent = entry.id;
  $('reader-title').textContent = entry.title;
  $('reader-tags').replaceChildren(...entry.tags.map(t => node('span', t)));
  $('reader-meta').textContent = [
    AI_TYPE_LABEL[entry.type] || '项目',
    aiStatusText(entry),
    entry.creator || '',
    entry.url ? `链接 ↗` : '',
  ].filter(Boolean).join(' · ');
  $('reader-meta').hidden = false;
  if (entry.url && /^https?:\/\//i.test(entry.url)) {
    $('reader-meta').append(' — ', (() => {
      const a = node('a', entry.url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
      a.href = entry.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      return a;
    })());
  }
  $('reader-body').replaceChildren(markdown(entry.body, entry.attachments));
  $('download-note').textContent = '下载这条记录 ↓';
  renderAttachments($('reader-attachments'), entry.attachments, anchor, () => openAI(anchor, true));
  // 正文「关联」里的 wiki 链接已渲染为可点按钮；这里补其它 AI 条目指向本条的回链
  const rel = (entry.rel || '').replace(/\.md$/, '');
  renderReaderLinks(rel
    ? state.ai.filter(l => l.anchor !== entry.anchor && l.links.some(t => t.replace(/\.md$/, '') === rel))
    : [], 'AI 库');

  if (!$('reader').open) $('reader').showModal();
  $('reader').scrollTop = 0;
  pushDetail(anchor, fromHash);
}

/* ---------- 附件 ---------- */
async function loadMedia(attachment) {
  if (state.media.has(attachment.file)) return state.media.get(attachment.file);
  const session = state.session;
  const key = state.key;
  const pending = (async () => {
    // cache:'no-store'：每次构建会用新 salt 重新加密附件，同名文件内容已变，
    // 用缓存的旧密文配新密钥会解密失败
    const response = await fetch(attachment.file, { cache: 'no-store' });
    if (!response.ok) throw new Error('附件读取失败');
    const data = new Uint8Array(await response.arrayBuffer());
    if (session !== state.session || !key) throw new Error('随记已锁定');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, 12), additionalData: encoder.encode(attachment.aad) },
      key, data.slice(12));
    if (session !== state.session) throw new Error('随记已锁定');
    const url = URL.createObjectURL(new Blob([plain], { type: attachment.mime }));
    state.urls.add(url);
    return url;
  })();
  state.media.set(attachment.file, pending);
  pending.catch(() => state.media.delete(attachment.file));
  return pending;
}

async function showImage(attachment) {
  try {
    const url = await loadMedia(attachment);
    if (!state.key) return;
    $('lightbox-image').src = url;
    $('lightbox-image').alt = attachment.name;
    $('lightbox').showModal();
  } catch {
    if (state.key) toast('图片暂时无法打开，请稍后重试。');
  }
}

/* 外链图片（官方海报）：直接进灯箱，浏览器加载 */
function showRemoteImage(url, alt) {
  $('lightbox-image').src = url;
  $('lightbox-image').alt = alt || '配图';
  $('lightbox').showModal();
}

/* ---------- 附件全屏浮层 ---------- */
function openAttachmentOverlay(attachment, url) {
  $('overlay-name').textContent = attachment.name;
  $('overlay-frame').src = `viewer.html?v=${VIEWER_VER}&name=${encodeURIComponent(attachment.name)}&bare=1#${encodeURIComponent(url)}`;
  const overlay = $('attachment-overlay');
  if (!overlay.open) overlay.showModal();
  $('overlay-close').focus();
}
function closeAttachmentOverlay() {
  const overlay = $('attachment-overlay');
  if (overlay.open) overlay.close();
}
$('attachment-overlay').addEventListener('close', () => { $('overlay-frame').src = 'about:blank'; });
$('overlay-close').addEventListener('click', closeAttachmentOverlay);
$('attachment-overlay').addEventListener('click', e => { if (e.target === $('attachment-overlay')) closeAttachmentOverlay(); });

/* ---------- Markdown 渲染（随记子集） ---------- */
/* wiki 链接解析：[[Attachments/…]] → 条目附件（图片内嵌/文件链接）、
   [[01-Journals/…]] → 随记、[[03-Lists/…]] → 书影条目；解析不到按纯文本 */
function resolveWiki(target, attachments) {
  const t = String(target).trim().replace(/\.md$/, '');
  if (!t) return null;
  if (t.startsWith('Attachments/')) {
    const name = t.slice('Attachments/'.length);
    const att = (attachments || []).find(a => a.name === name);
    if (!att) return null;
    return att.mime.startsWith('image/') ? { kind: 'att-image', att } : { kind: 'att-file', att };
  }
  const hit = state.notes.find(n => (n.rel || '').replace(/\.md$/, '') === t)
    || state.lists.find(n => (n.rel || '').replace(/\.md$/, '') === t)
    || state.ai.find(n => (n.rel || '').replace(/\.md$/, '') === t);
  if (!hit) return null;
  return { kind: hit.anchor.startsWith('list-') ? 'list' : hit.anchor.startsWith('ai-') ? 'ai' : 'note', anchor: hit.anchor };
}
function inline(text, target, attachments) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|!\[[^\]]*\]\([^\s)]+\)|!?\[\[[^\]]+\]\]|\[[^\]]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(start, match.index)));
    const value = match[0];
    if (value.startsWith('`')) target.append(node('code', value.slice(1, -1)));
    else if (value.startsWith('**')) target.append(node('strong', value.slice(2, -2)));
    else if (value.startsWith('![')) {
      // 外链图片（官方海报等）：浏览器直接加载显示
      const m = value.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (m && /^https?:\/\//i.test(m[2])) {
        const img = node('img', undefined, 'remote-img');
        img.src = m[2];
        img.alt = m[1] || '配图';
        img.loading = 'lazy';
        target.append(img);
      } else {
        target.append(document.createTextNode(value));
      }
    } else if (value.includes('[[')) {
      const inside = value.replace(/^!?\[\[|\]\]$/g, '');
      const [path, label] = inside.split('|');
      const text = (label || path.split('/').at(-1).replace(/\.[^.]+$/, '')).trim();
      const dest = resolveWiki(path, attachments);
      if (dest?.kind === 'att-image' || dest?.kind === 'att-file') {
        // 正文引用附件：渲染为轻量标签（附件统一在底部附件区展示，正文不内嵌）。
        // 点击图片开灯箱，文件直接下载，HTML 开全屏浮层。
        const isImage = dest.kind === 'att-image';
        const icon = isImage ? '🖼' : '📎';
        const b = button(`${icon} ${text}`, 'att-ref', () => {
          if (isImage) showImage(dest.att);
          else if (dest.att.mime === 'text/html') {
            loadMedia(dest.att).then(url => openAttachmentOverlay(dest.att, url)).catch(() => toast('附件暂时无法打开。'));
          } else {
            loadMedia(dest.att).then(url => {
              const a = node('a');
              a.href = url;
              a.download = dest.att.name;
              a.click();
            }).catch(() => toast('附件暂时无法打开。'));
          }
        });
        target.append(b);
      } else if (dest) {
        const open = () => (dest.kind === 'list' ? openList : dest.kind === 'ai' ? openAI : openNote)(dest.anchor);
        target.append(button(text, 'wiki-link', open));
      } else {
        target.append(document.createTextNode(text));
      }
    } else {
      const parts = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (parts && /^https?:\/\//i.test(parts[2])) {
        const a = node('a', parts[1]);
        a.href = parts[2];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        target.append(a);
      } else {
        target.append(document.createTextNode(value));
      }
    }
    start = match.index + value.length;
  }
  target.append(document.createTextNode(text.slice(start)));
}

function markdown(text, attachments) {
  const root = node('div');
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim() === '---') { i++; continue; }
    if (line.startsWith('```')) {
      const pre = node('pre'), code = node('code');
      const block = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) block.push(lines[i++]);
      code.textContent = block.join('\n');
      pre.append(code);
      root.append(pre);
      i++;
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const marks = line.match(/^(#+)\s/)[1].length;
      const heading = node(marks === 1 ? 'h2' : `h${marks}`);
      inline(line.slice(marks + 1), heading, attachments);
      root.append(heading);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const block = node('blockquote');
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const p = node('p');
        inline(lines[i++].replace(/^\s*>\s?/, ''), p, attachments);
        block.append(p);
      }
      root.append(block);
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const list = node('ul');
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const item = node('li');
        inline(lines[i++].replace(/^\s*[-*]\s/, ''), item, attachments);
        list.append(item);
      }
      root.append(list);
      continue;
    }
    const p = node('p');
    const block = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|[-*]\s|```)/.test(lines[i])) block.push(lines[i++]);
    inline(block.join('\n'), p, attachments);
    root.append(p);
  }
  return root;
}

/* ---------- 阅读器 ---------- */
function openNote(anchor, fromHash) {
  const note = state.notes.find(n => n.anchor === anchor);
  if (!note) return;
  state.currentAnchor = anchor;
  state.currentDetail = { kind: 'note', anchor };
  $('reader-date').textContent = dateLabel(note);
  $('reader-id').textContent = note.id;
  $('reader-title').textContent = note.title;
  $('reader-tags').replaceChildren(...note.tags.map(t => node('span', t)));
  $('reader-meta').hidden = true;
  $('reader-body').replaceChildren(markdown(note.body, note.attachments));
  $('download-note').textContent = '下载这条随记 ↓';
  renderAttachments($('reader-attachments'), note.attachments, anchor, () => openNote(anchor, true));

  // 回链：扫清单/AI 库正文的 wiki 链接，找出指向这篇随记的条目
  const rel = (note.rel || '').replace(/\.md$/, '');
  const backlinks = rel
    ? [...state.lists.filter(l => l.links.some(t => t.replace(/\.md$/, '') === rel)),
       ...state.ai.filter(l => l.links.some(t => t.replace(/\.md$/, '') === rel))]
    : [];
  renderReaderLinks(backlinks, '相关条目');

  if (!$('reader').open) $('reader').showModal();
  $('reader').scrollTop = 0;
  pushDetail(anchor, fromHash);
}

function openList(anchor, fromHash) {
  const entry = state.lists.find(n => n.anchor === anchor);
  if (!entry) return;
  state.currentAnchor = anchor;
  state.currentDetail = { kind: 'list', anchor };
  $('reader-date').textContent = `加入于 ${dateLabel({ date: entry.added })}`;
  $('reader-id').textContent = entry.id;
  $('reader-title').textContent = entry.title;
  $('reader-tags').replaceChildren(...entry.tags.map(t => node('span', t)));
  $('reader-meta').textContent = [
    entry.type === 'movie' ? '影视' : '书籍',
    listStatusText(entry),
    listMetaText(entry),
    entry.started ? `开始 ${entry.started}` : '',
    entry.finished ? `完成 ${entry.finished}` : '',
  ].filter(Boolean).join(' · ');
  $('reader-meta').hidden = false;
  $('reader-body').replaceChildren(markdown(entry.body, entry.attachments));
  $('download-note').textContent = '下载这条记录 ↓';
  renderAttachments($('reader-attachments'), entry.attachments, anchor, () => openList(anchor, true));
  // 正文「关联」里的 wiki 链接已渲染为可点按钮；这里补其它书影指向本条的回链
  const rel = (entry.rel || '').replace(/\.md$/, '');
  renderReaderLinks(rel
    ? state.lists.filter(l => l.anchor !== entry.anchor && l.links.some(t => t.replace(/\.md$/, '') === rel))
    : []);

  if (!$('reader').open) $('reader').showModal();
  $('reader').scrollTop = 0;
  pushDetail(anchor, fromHash);
}

function renderReaderLinks(entries, label) {
  const box = $('reader-links');
  box.replaceChildren();
  if (!entries.length) { box.hidden = true; return; }
  box.append(node('p', label || '相关书影', 'reader-links-title'));
  entries.forEach(l => box.append(button(`《${l.title}》`, 'reader-link-chip', () => {
    if (l.anchor.startsWith('ai-')) openAI(l.anchor);
    else openList(l.anchor);
  })));
  box.hidden = false;
}

/* 深链历史：打开详情入 history（返回键 = 回上一状态）；
   从 hash 进入或同锚重开时只 replaceState，不堆历史项 */
function pushDetail(anchor, fromHash) {
  if (fromHash || location.hash === `#${anchor}`) {
    history.replaceState({ detail: anchor }, '', `#${anchor}`);
    return;
  }
  state.detailDepth++;
  history.pushState({ detail: anchor }, '', `#${anchor}`);
}

function closeDetail() {
  if (state.detailDepth > 0 && history.state?.detail) history.back();
  else $('reader').close();
}

window.addEventListener('popstate', () => {
  if (state.detailDepth > 0) state.detailDepth--;
  if (!state.key) return;
  const h = location.hash.slice(1);
  if (h.startsWith('card-') && state.notes.some(n => n.anchor === h)) { openNote(h, true); return; }
  if (h.startsWith('list-') && state.lists.some(n => n.anchor === h)) { openList(h, true); return; }
  if (h.startsWith('ai-') && state.ai.some(n => n.anchor === h)) { openAI(h, true); return; }
  ['reader', 'lightbox'].forEach(id => { if ($(id).open) $(id).close(); });
});

/* 附件渲染：随记与书影条目共用（图片/音视频/HTML 沙箱预览/文本/下载） */
function renderAttachments(container, attachments, anchor, reopen) {
  container.replaceChildren();
  for (const attachment of attachments) {
    const figure = node('figure');
    figure.append(node('figcaption', attachment.name));
    container.append(figure);
    const isHtml = /text\/html/.test(attachment.mime) || /\.html?$/i.test(attachment.name);
    const isText = /^(text\/plain|text\/markdown)$/.test(attachment.mime);
    loadMedia(attachment)
      .then(url => {
        if (state.currentAnchor !== anchor || !figure.isConnected || !state.key) return;
        if (attachment.mime.startsWith('image/')) {
          const img = node('img');
          img.src = url;
          img.alt = attachment.name;
          img.addEventListener('click', () => showImage(attachment));
          figure.prepend(img);
        } else if (/^(audio|video)\//.test(attachment.mime)) {
          const media = node(attachment.mime.split('/')[0]);
          media.src = url;
          media.controls = true;
          media.preload = 'metadata';
          figure.prepend(media);
        } else if (isHtml) {
          // HTML 附件：页内沙箱预览 + 新标签打开 + 下载
          const wrap = node('div', undefined, 'attachment-web');
          const preview = node('iframe', undefined, 'attachment-frame');
          // 外层只承载自带的 viewer.html（可信）；附件内容在 viewer 内部的沙箱 iframe 里运行
          preview.title = `${attachment.name} 预览`;
          const viewerUrl = `viewer.html?v=${VIEWER_VER}&name=${encodeURIComponent(attachment.name)}#${encodeURIComponent(url)}`;
          preview.src = viewerUrl;
          const actions = node('div', undefined, 'attachment-actions');
          const expand = button('⛶', 'attachment-expand', () => openAttachmentOverlay(attachment, url));
          expand.setAttribute('aria-label', '全屏预览');
          const open = node('a', '在新标签中打开 ↗', 'attachment-open');
          open.href = `viewer.html?v=${VIEWER_VER}&name=${encodeURIComponent(attachment.name)}#${encodeURIComponent(url)}`;
          open.target = '_blank';
          open.rel = 'noreferrer noopener';
          const dl = node('a', '下载 ↓', 'attachment-download');
          dl.href = url;
          dl.download = attachment.name;
          actions.append(expand, open, dl);
          wrap.append(actions, preview);  // 按钮行在上，预览在下（统一顶部）
          figure.prepend(wrap);
        } else if (isText) {
          const box = node('details', undefined, 'attachment-text');
          box.append(node('summary', '展开文本内容'));
          const pre = node('pre');
          pre.textContent = '';
          box.append(pre);
          figure.prepend(box);
          fetch(url).then(r => r.text()).then(t => { pre.textContent = t.slice(0, 20000); }).catch(() => {});
          const dl = node('a', '下载 ↓', 'attachment-download');
          dl.href = url;
          dl.download = attachment.name;
          figure.append(dl);
        } else {
          const link = node('a', '下载附件 ↓', 'attachment-download');
          link.href = url;
          link.download = attachment.name;
          figure.prepend(link);
        }
      })
      .catch(() => {
        if (!figure.isConnected || !state.key) return;
        const retry = button('附件加载失败，点此重试', 'attachment-download', () => {
          state.media.delete(attachment.file);
          reopen();
        });
        figure.prepend(retry);
      });
  }
}

function openMonthSheet() {
  $('month-sheet').hidden = false;
  document.body.classList.add('sheet-open');
}
function closeMonthSheet() {
  const sheet = $('month-sheet');
  if (sheet) { sheet.hidden = true; document.body.classList.remove('sheet-open'); }
}

function randomNote() {
  if (state.notes.length) openNote(state.notes[Math.floor(Math.random() * state.notes.length)].anchor);
}

function downloadNote() {
  const d = state.currentDetail;
  const note = d && d.kind === 'list'
    ? state.lists.find(n => n.anchor === d.anchor)
    : d && d.kind === 'ai'
      ? state.ai.find(n => n.anchor === d.anchor)
      : state.notes.find(n => n.anchor === state.currentAnchor);
  if (!note) return;
  const url = URL.createObjectURL(new Blob([note.raw], { type: 'text/markdown;charset=utf-8' }));
  const a = node('a');
  a.href = url;
  a.download = `${note.id}-${note.title.replace(/[<>:"/\\|?*]/g, '-')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 事件绑定 ---------- */
// 翻开的内页日期：跟随今天
try {
  const pd = $('page-date');
  const d = new Date();
  if (pd) pd.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
} catch { }

$('unlock-form').addEventListener('submit', unlock);
$('show-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('show-password').textContent = show ? '隐藏' : '显示';
  $('show-password').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
});
['lock-button', 'mobile-lock'].forEach(id => $(id).addEventListener('click', lockJournal));
$('all-notes').addEventListener('click', () => { setView('notes'); resetFilters(); });
['clear-filter', 'empty-reset'].forEach(id => $(id).addEventListener('click', resetFilters));
$('list-nav').addEventListener('click', () => setView('lists'));
$('ai-nav').addEventListener('click', () => setView('ai'));
$('mobile-view-notes').addEventListener('click', () => setView('notes'));
$('mobile-view-lists').addEventListener('click', () => setView('lists'));
$('mobile-view-ai').addEventListener('click', () => setView('ai'));
$('lists-sort').addEventListener('click', () => {
  const order = ['added', 'priority', 'rating'];
  state.listSort = order[(order.indexOf(state.listSort) + 1) % order.length];
  renderLists();
});
$('ai-sort').addEventListener('click', () => {
  const order = ['added', 'type'];
  state.aiSort = order[(order.indexOf(state.aiSort) + 1) % order.length];
  renderAI();
});
['random-note', 'revisit-button'].forEach(id => $(id).addEventListener('click', randomNote));
$('sort-button').addEventListener('click', () => { state.ascending = !state.ascending; render(); });
$('image-filter').addEventListener('click', () => { state.filter.images = !state.filter.images; render(); });
$('search').addEventListener('input', () => {
  state.filter.q = $('search').value;
  if (state.view === 'lists') renderLists();
  else if (state.view === 'ai') renderAI();
  else render();
});
$('calendar-prev').addEventListener('click', () => moveCalendar(-1));
$('calendar-next').addEventListener('click', () => moveCalendar(1));
$('close-reader').addEventListener('click', closeDetail);
$('close-lightbox').addEventListener('click', () => $('lightbox').close());
$('reader').addEventListener('close', () => {
  state.currentAnchor = null;
  state.currentDetail = null;
  ['reader-body', 'reader-attachments', 'reader-links'].forEach(id => $(id).replaceChildren());
  $('reader-meta').hidden = true;
  // Esc 关闭也走"返回上一状态"：弹掉本次详情的历史项；popstate 路径 depth 已减，不会误回退
  if (state.detailDepth > 0 && history.state?.detail && location.hash === `#${history.state.detail}`) history.back();
  else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});
['reader', 'lightbox'].forEach(id => $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).close(); }));
$('download-note').addEventListener('click', downloadNote);

document.addEventListener('keydown', e => {
  state.lastActive = Date.now();
  if (e.key === '/' && state.key && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('reader').open) {
    e.preventDefault();
    $('search').focus();
  }
});
['pointerdown', 'scroll', 'touchstart'].forEach(event =>
  document.addEventListener(event, () => { state.lastActive = Date.now(); }, { passive: true }));

setInterval(() => {
  if (state.key && Date.now() - state.lastActive > 30 * 60 * 1000) {
    lockJournal();
    $('unlock-message').textContent = '离开已有一会儿，随记已自动锁定。';
  }
}, 60000);

/* ---------- 配色主题（右下角切换，选择记忆在本机） ---------- */
const THEMES = [
  { id: 'sage', label: '鼠尾草 · 默认', swatch: ['#f7f8f2', '#416647', '#27392f'] },
  { id: 'terracotta', label: '陶土 · 暖阳', swatch: ['#faf6ef', '#b0543a', '#3b2c22'] },
  { id: 'sakura', label: '樱语 · 初绽', swatch: ['#fdf5f6', '#b04a64', '#3d2a2e'] },
  { id: 'lavender', label: '薰衣草 · 暮色', swatch: ['#f7f5fb', '#6b5ca8', '#2e2a3d'] },
  { id: 'sky', label: '晴空 · 远山', swatch: ['#f2f7fa', '#2f7091', '#22323c'] },
  { id: 'night', label: '夜阑 · 烛光', swatch: ['#1e2229', '#d2a765', '#ece7dc'] },
];

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.swatch[0];
  try { localStorage.setItem('journal-theme', theme.id); } catch { }
  document.querySelectorAll('.theme-option').forEach(el => el.classList.toggle('active', el.dataset.theme === theme.id));
  // 让已打开的附件预览（同源 iframe）实时跟随主题
  document.querySelectorAll('.attachment-frame, #overlay-frame').forEach(fr => {
    try { fr.contentWindow.__suijiSyncTheme?.(); } catch { }
  });
}

(function initThemePicker() {
  let saved = null;
  try { saved = localStorage.getItem('journal-theme'); } catch { }
  if (!saved) {
    saved = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'sage';
  }
  const options = $('theme-options');
  for (const theme of THEMES) {
    const el = button('', 'theme-option', () => applyTheme(theme.id));
    el.dataset.theme = theme.id;
    const swatches = node('span', undefined, 'theme-swatches');
    theme.swatch.forEach(color => { const dot = node('i'); dot.style.background = color; swatches.append(dot); });
    el.append(swatches, node('span', theme.label), node('span', '✓', 'check'));
    options.append(el);
  }
  applyTheme(saved);
  $('theme-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const panel = $('theme-panel');
    panel.hidden = !panel.hidden;
    $('theme-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.theme-picker')) {
      $('theme-panel').hidden = true;
      $('theme-toggle').setAttribute('aria-expanded', 'false');
    }
  });
})();
