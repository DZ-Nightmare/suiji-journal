#!/usr/bin/env node
'use strict';
/* 配色科学校验：WCAG 相对亮度 + 对比度（AA：正文 ≥4.5:1，大字/UI ≥3:1）
   用法：node tools/check-themes.js   （读取 tools/themes.json 并逐主题校验） */
const themes = require('./themes.json');

function srgb(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [前景, 背景, 场景, 最低要求]
const PAIRS = [
  ['ink', 'bg', '标题 × 页面底色', 4.5],
  ['body', 'bg', '正文 × 页面底色', 4.5],
  ['body', 'surface', '正文 × 卡片', 4.5],
  ['muted', 'bg', '弱化文字 × 页面底色', 3.0],
  ['accent', 'bg', '强调文字 × 页面底色', 3.0],
  ['accent', 'surface', '强调文字 × 卡片', 3.0],
  ['on-accent', 'accent', '按钮文字 × 按钮底色', 4.5],
  ['ink', 'soft', '标题 × 浅底块', 4.5],
  ['accent-dark', 'soft', '强调深色 × 浅底块', 3.0],
  ['bg', 'ink', '反白文字 × 墨色块', 4.5],
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n■ ${name} ${t.label}`);
  for (const [fg, bg, scene, min] of PAIRS) {
    const ratio = contrast(t.colors[fg], t.colors[bg]);
    const ok = ratio >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${scene}：${ratio.toFixed(2)}:1（≥${min}）`);
  }
}
console.log(failed ? `\n✗ 共 ${failed} 项未达标` : '\n✓ 全部主题全部指标达标');
process.exit(failed ? 1 : 0);
