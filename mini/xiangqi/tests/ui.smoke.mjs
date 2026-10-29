// 用最小 DOM stub 加载 main.js，验证界面逻辑不报错
import fs from 'node:fs';

const listeners = {};
function makeEl(id) {
  return {
    id, hidden: false, textContent: '', innerHTML: '', scrollTop: 0, scrollHeight: 1000,
    style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(t, fn) { (listeners[id + ':' + t] ||= []).push(fn); },
    querySelectorAll() { return []; },
    querySelector() { return makeEl('sub'); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 1000 }; },
    getContext() { return canvasCtx; },
    appendChild(child) { return child; },
    setAttribute() {}, getAttribute() { return null; },
    width: 900, height: 1000,
  };
}
const gradientStub = { addColorStop() {} };
const canvasCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradientStub;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

const els = {};
for (const id of ['board','statusLine','thinking','turnText','turnBadge','checkWarn','moveList','aiMeta','overlay','ovTitle','ovText','ovNew','btnNew','btnUndo','modeGroup','diffGroup','difficultyGroup','colorGroup','colorPick']) {
  els[id] = makeEl(id);
}
els.board.getContext = () => canvasCtx;
global.window = { addEventListener(){}, };
global.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.document = {
  getElementById: (id) => els[id] || makeEl(id),
  querySelector: () => makeEl('q'),
  querySelectorAll: () => [],
  createElement: (tag) => {
    const e = makeEl('created-' + tag);
    e.tag = tag;
    e.closest = (sel) => (sel === '.eg-item' ? e : null);
    return e;
  },
  addEventListener(){},
};
global.performance = { now: () => Date.now() };
global.MouseEvent = class { constructor(t, o) { Object.assign(this, o); this.type = t; } };

try {
  await import('../app/main.js');
  console.log('✓ main.js 加载成功，界面逻辑无运行时错误');
} catch (e) {
  console.log('✗ main.js 加载失败:', e.message);
  console.log(e.stack);
  process.exit(1);
}
