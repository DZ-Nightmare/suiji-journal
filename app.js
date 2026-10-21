'use strict';
/* 随记 · 前端逻辑：解锁 / 时间轴 / 筛选 / 日历 / 阅读器 / 附件解密 */
const $ = id => document.getElementById(id);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const state = {
  key: null, notes: [], media: new Map(), urls: new Set(),
  session: 0, currentAnchor: null, ascending: false, calendar: '',
  lastActive: Date.now(),
  filter: { q: '', tag: '', topic: '', month: '', day: '', images: false },
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
    state.notes = payload.notes;
    state.session++;
    state.lastActive = Date.now();
    state.calendar = state.notes.length
      ? state.notes.map(n => n.date.slice(0, 7)).sort().at(-1)
      : new Date().toISOString().slice(0, 7);
    $('password').value = '';
    $('password').type = 'password';
    $('show-password').textContent = '显示';
    $('unlock-message').textContent = '内容与附件均已加密，仅在当前浏览器解锁。';
    $('lock-screen').hidden = true;
    $('journal').hidden = false;
    $('updated-at').textContent = payload.built_at
      ? `页面更新于 ${payload.built_at.slice(0, 16).replace('T', ' ')}（北京时间）` : '';
    populate();
    resetFilters();
    if (location.hash.startsWith('#card-')) openNote(location.hash.slice(1));
    window.scrollTo(0, 0);
  } catch (error) {
    $('unlock-message').textContent = error.message || '打开失败，请重试。';
    $('unlock-message').classList.add('error');
  } finally {
    submit.disabled = false;
    submit.replaceChildren(document.createTextNode('打开我的随记 '), node('span', '↗'));
  }
}

function lockJournal() {
  state.session++;
  state.key = null;
  state.notes = [];
  state.currentAnchor = null;
  state.media.clear();
  state.urls.forEach(url => URL.revokeObjectURL(url));
  state.urls.clear();
  ['reader', 'lightbox'].forEach(id => $(id).close());
  ['timeline', 'month-nav', 'topic-nav', 'filter-tags', 'calendar-grid', 'reader-body', 'reader-attachments', 'reader-tags'].forEach(id => $(id).replaceChildren());
  ['reader-title', 'reader-id', 'reader-date', 'updated-at', 'start-date', 'calendar-title', 'visible-count', 'footer-count'].forEach(id => { $(id).textContent = ''; });
  ['total-count', 'day-count', 'nav-count'].forEach(id => { $(id).textContent = '0'; });
  $('lightbox-image').removeAttribute('src');
  $('search').value = '';
  $('password').value = '';
  $('journal').hidden = true;
  $('lock-screen').hidden = false;
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

  // 手机端：侧栏隐藏后提供月份下拉与「偶遇旧念头」入口
  if (!$('mobile-month')) {
    const select = node('select', undefined, 'mobile-month');
    select.id = 'mobile-month';
    select.setAttribute('aria-label', '按月份筛选随记');
    select.addEventListener('change', () => {
      state.filter.month = select.value;
      state.filter.day = '';
      state.calendar = select.value || state.calendar;
      render();
    });
    $('sort-button').before(select);
    const revisit = button('✧ 偶遇一条旧念头 ↗', 'mobile-revisit', randomNote);
    revisit.id = 'mobile-revisit';
    document.querySelector('.hero-meta').after(revisit);
  }
  const allMonth = node('option', '全部月份');
  allMonth.value = '';
  $('mobile-month').replaceChildren(allMonth, ...months.map(month => {
    const option = node('option', `${month.slice(0, 4)}.${month.slice(5, 7)}`);
    option.value = month;
    return option;
  }));
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
  if (mobileMonth) mobileMonth.value = f.month;
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

/* ---------- 附件全屏浮层 ---------- */
function openAttachmentOverlay(attachment, url) {
  $('overlay-name').textContent = attachment.name;
  $('overlay-frame').src = `viewer.html?name=${encodeURIComponent(attachment.name)}#${encodeURIComponent(url)}`;
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
function inline(text, target) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|!?\[\[[^\]]+\]\]|\[[^\]]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(start, match.index)));
    const value = match[0];
    if (value.startsWith('`')) target.append(node('code', value.slice(1, -1)));
    else if (value.startsWith('**')) target.append(node('strong', value.slice(2, -2)));
    else if (value.includes('[[')) {
      const inside = value.replace(/^!?\[\[|\]\]$/g, '');
      const [path, label] = inside.split('|');
      target.append(document.createTextNode((label || path.split('/').at(-1).replace(/\.[^.]+$/, '')).trim()));
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

function markdown(text) {
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
      inline(line.slice(marks + 1), heading);
      root.append(heading);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const block = node('blockquote');
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const p = node('p');
        inline(lines[i++].replace(/^\s*>\s?/, ''), p);
        block.append(p);
      }
      root.append(block);
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const list = node('ul');
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const item = node('li');
        inline(lines[i++].replace(/^\s*[-*]\s/, ''), item);
        list.append(item);
      }
      root.append(list);
      continue;
    }
    const p = node('p');
    const block = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|[-*]\s|```)/.test(lines[i])) block.push(lines[i++]);
    inline(block.join('\n'), p);
    root.append(p);
  }
  return root;
}

/* ---------- 阅读器 ---------- */
function openNote(anchor) {
  const note = state.notes.find(n => n.anchor === anchor);
  if (!note) return;
  state.currentAnchor = anchor;
  $('reader-date').textContent = dateLabel(note);
  $('reader-id').textContent = note.id;
  $('reader-title').textContent = note.title;
  $('reader-tags').replaceChildren(...note.tags.map(t => node('span', t)));
  $('reader-body').replaceChildren(markdown(note.body));
  $('reader-attachments').replaceChildren();

  for (const attachment of note.attachments) {
    const figure = node('figure');
    figure.append(node('figcaption', attachment.name));
    $('reader-attachments').append(figure);
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
          const viewerUrl = `viewer.html?name=${encodeURIComponent(attachment.name)}#${encodeURIComponent(url)}`;
          preview.src = viewerUrl;
          const actions = node('div', undefined, 'attachment-actions');
          const expand = button('⛶', 'attachment-expand', () => openAttachmentOverlay(attachment, url));
          expand.setAttribute('aria-label', '全屏预览');
          const open = node('a', '在新标签中打开 ↗', 'attachment-open');
          open.href = `viewer.html?name=${encodeURIComponent(attachment.name)}#${encodeURIComponent(url)}`;
          open.target = '_blank';
          open.rel = 'noreferrer noopener';
          const dl = node('a', '下载 ↓', 'attachment-download');
          dl.href = url;
          dl.download = attachment.name;
          actions.append(expand, open, dl);
          wrap.append(preview, actions);
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
          figure.replaceChildren(node('figcaption', attachment.name));
          openNote(anchor);
        });
        figure.prepend(retry);
      });
  }
  if (!$('reader').open) $('reader').showModal();
  $('reader').scrollTop = 0;
  history.replaceState(null, '', `#${anchor}`);
}

function randomNote() {
  if (state.notes.length) openNote(state.notes[Math.floor(Math.random() * state.notes.length)].anchor);
}

function downloadNote() {
  const note = state.notes.find(n => n.anchor === state.currentAnchor);
  if (!note) return;
  const url = URL.createObjectURL(new Blob([note.raw], { type: 'text/markdown;charset=utf-8' }));
  const a = node('a');
  a.href = url;
  a.download = `${note.id}-${note.title.replace(/[<>:"/\\|?*]/g, '-')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 事件绑定 ---------- */
$('unlock-form').addEventListener('submit', unlock);
$('show-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('show-password').textContent = show ? '隐藏' : '显示';
  $('show-password').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
});
['lock-button', 'mobile-lock'].forEach(id => $(id).addEventListener('click', lockJournal));
['all-notes', 'clear-filter', 'empty-reset'].forEach(id => $(id).addEventListener('click', resetFilters));
['random-note', 'revisit-button'].forEach(id => $(id).addEventListener('click', randomNote));
$('sort-button').addEventListener('click', () => { state.ascending = !state.ascending; render(); });
$('image-filter').addEventListener('click', () => { state.filter.images = !state.filter.images; render(); });
$('search').addEventListener('input', () => { state.filter.q = $('search').value; render(); });
$('calendar-prev').addEventListener('click', () => moveCalendar(-1));
$('calendar-next').addEventListener('click', () => moveCalendar(1));
$('close-reader').addEventListener('click', () => $('reader').close());
$('close-lightbox').addEventListener('click', () => $('lightbox').close());
$('reader').addEventListener('close', () => {
  state.currentAnchor = null;
  $('reader-body').replaceChildren();
  $('reader-attachments').replaceChildren();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
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
