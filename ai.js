/* 随记 · AI 能力（2026-11-26 起）
   MIMO 开放平台（OpenAI 兼容协议），浏览器直连：
   - CORS：access-control-allow-origin: *（已实测），静态站可从任何域名调用
   - key 处理：存放在你自己的浏览器 localStorage，不进公开仓库、不进加密载荷；
     首次用 AI 能力时提示粘贴，之后免输入，随时可清
   - 模型：mimo-v2.6-pro（流式输出）。API 文档 https://mimo.mi.com/docs
   第一期：AI 点评随记（侧栏「AI 助手」按钮）。站点仍是加密只读，点评不进载荷，
   刷新即散；用户想留就把点评复制 / 说给随记 AI 记下来。 */
'use strict';

/* ---------- 配置 ---------- */
const MIMO_BASE = 'https://api.xiaomimimo.com/v1';
const MIMO_MODEL = 'mimo-v2.6-pro';
const MIMO_KEY_LOCAL = 'suiji-mimo-key';
const MAX_NOTE_CHARS = 4000;

/* ---------- 状态 ---------- */
const aiState = { key: '', busy: false, panel: null };

function saveKey(k) {
  aiState.key = (k || '').trim();
  try { localStorage.setItem(MIMO_KEY_LOCAL, aiState.key); } catch { /* 隐私模式忽略 */ }
}
function loadKey() {
  try { aiState.key = localStorage.getItem(MIMO_KEY_LOCAL) || ''; } catch { aiState.key = ''; }
  return aiState.key;
}

/* ---------- 会话（仅存内存，不落盘）---------- */
const aiSession = [];
const SYSTEM = [
  '你是「随记」的 AI 助手，帮用户整理、回想、消化自己的私人随记。',
  '规则：',
  '1. 点评随记时，先引用原文里最触动的一句话，再用一两句说出它为什么值得留——不做泛泛夸奖，不做评价摘要式的复述。',
  '2. 回答只围绕用户选的随记和用户说的话，不编造随记里没有的内容。',
  '3. 语气像一位安静、真诚的朋友，不用感叹号，不列广告式要点；除非用户要求，否则不加格式标记。',
  '4. 用户没有明确要求时，回复控制在 120 字以内。',
  '5. 引用的原文可能只是随记片段，不要假设它是全部。',
].join('\n');

/* ---------- MIMO 调用 ---------- */
async function mimoChat(messages) {
  const res = await fetch(`${MIMO_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiState.key}` },
    body: JSON.stringify({ model: MIMO_MODEL, messages, stream: true }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const e = await res.json(); detail = e?.error?.message || detail; } catch {}
    throw new Error(`MIMO 调用失败：${detail}`);
  }
  return res;
}

/* 流式读取 SSE：MIMO 返回 data: {choices:[{delta:{content}}]} 行，data: [DONE] 结束 */
async function streamText(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const piece = json?.choices?.[0]?.delta?.content ?? '';
        if (piece) onDelta(piece);
      } catch { /* 半个 chunk，等下一行 */ }
    }
  }
}

/* ---------- 面板 ---------- */
function panelHTML() {
  return `
    <button class="ai-close" data-host-ai-close aria-label="收起 AI 助手">✕</button>
    <div class="ai-panel-header">
      <span class="ai-panel-title">AI 助手</span>
      <span class="ai-panel-model">mimo-v2.6-pro</span>
    </div>
    <div class="ai-msg-list" data-host-ai-msgs></div>
    <div class="ai-ai-shot"></div>
    <div class="ai-panel-meta-label">➤ 支持的几件事</div>
    <div class="ai-chips">
      <button data-host-ai-chip="谈心">✍️ 与我谈心</button>
      <button data-host-ai-chip="问问我">🤔 问问我</button>
      <button data-host-ai-chip="写封信">💌 写封信</button>
      <button data-host-ai-chip="剧本杀">🎭 剧本杀</button>
    </div>
    <div class="ai-input-row">
      <textarea class="ai-input" data-host-ai-input rows="3" placeholder="对这条随记说点什么…"></textarea>
      <button class="ai-send" data-host-ai-send>发送</button>
    </div>
    <div class="ai-status" data-host-ai-status></div>
  `;
}

function openPanel(noteText, noteTitle) {
  if (aiState.panel) aiState.panel.remove();
  const panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.innerHTML = panelHTML();
  document.body.appendChild(panel);
  aiState.panel = panel;

  const msgs = panel.querySelector('[data-host-ai-msgs]');
  const statusEl = panel.querySelector('[data-host-ai-status]');
  const input = panel.querySelector('[data-host-ai-input]');
  const sendBtn = panel.querySelector('[data-host-ai-send]');

  /* 摘要卡片 */
  const card = document.createElement('div');
  card.className = 'ai-msg-card';
  card.textContent = noteText.length > 200 ? noteText.slice(0, 200) + '…' : noteText;
  msgs.appendChild(card);

  const addMsg = (role, text) => {
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  };

  const send = async (optionalText) => {
    const text = (optionalText ?? input.value).trim();
    if (!text) { input.focus(); return; }
    input.value = '';
    if (!aiState.key) { addMsg('ai', '我还没有 MIMO key，先粘贴一个（只存在这台浏览器里）。'); if (!(await requestKey())) return; }
    if (aiState.busy) return;
    aiState.busy = true; sendBtn.disabled = true;
    const userMsg = addMsg('user', text);
    const aiMsg = addMsg('ai', '');
    try {
      const messages = [...aiSession, { role: 'user', content: text }];
      const response = await mimoChat(messages);
      let acc = '';
      await streamText(response, (piece) => { acc += piece; aiMsg.textContent = acc; msgs.scrollTop = msgs.scrollHeight; });
      aiSession.push({ role: 'user', content: text }, { role: 'assistant', content: acc });
      if (statusEl) statusEl.textContent = '点评完成 · 内容只在本次会话，刷新即散';
    } catch (err) {
      aiMsg.textContent = `出错了：${err.message}`;
      if (statusEl) statusEl.textContent = '出错了';
    } finally {
      aiState.busy = false; sendBtn.disabled = false;
    }
  };

  sendBtn.addEventListener('click', () => send());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  panel.querySelector('[data-host-ai-close]').addEventListener('click', () => { panel.remove(); aiState.panel = null; });
  /* 工具栏动作：把第一个气泡替换成该随记的出处信息，然后发送 */
  panel.querySelectorAll('[data-host-ai-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const action = chip.dataset.hostAiChip;
      if (!noteText) { addMsg('ai', '请先选择一条随记。'); return; }
      msgs.innerHTML = '';
      const context = document.createElement('div');
      context.className = 'ai-msg user';
      context.textContent = `【${action}】这是我要你陪我做的随记：《${noteTitle || '无题'}》\n\n${noteText.slice(0, MAX_NOTE_CHARS)}`;
      msgs.appendChild(context);
      send(action === '问问我' ? '请你先问我两三个问题，再根据我的回答给我一点新的视角。'
        : action === '写封信' ? '请以这封随记的心情，写一封写给未来自己的小信。'
        : action === '剧本杀' ? '请你把这条随记改编成一个极短的剧本杀开场，给我一个角色、一个场景、一个悬念。'
        : '陪我聊聊这条随记，别问问题，先说说你看到的。');
    });
  });
}

async function requestKey() {
  const key = prompt('粘贴你的 MIMO API Key（只保存在本机浏览器，不会上传）');
  if (key) { saveKey(key); return key; }
  return null;
}

function setupKeyEntry() {
  const host = document.querySelector('[data-host-ai-key]');
  if (!host) return;
  loadKey(); // 读本地
  if (aiState.key) {
    host.textContent = '✓ 已配置 MIMO Key（点我更换/清除）';
    host.classList.add('has-key');
  }
  host.addEventListener('click', async () => {
    const k = await requestKey();
    host.textContent = aiState.key ? '✓ 已配置 MIMO Key（点我更换/清除）' : '配置 MIMO Key（本机浏览器本地保存）';
    host.classList.toggle('has-key', !!aiState.key);
  });
}

/* 暴露给 app.js */
window.aiModule = { openPanel, requestKey, setupKeyEntry, loadKey, saveKey };