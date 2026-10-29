// 端到端验证：把 dist/中国象棋.html 里的内联 bundle 抽出来，
// 提供 DOM stub 后真实执行，确认单文件版能完整启动并走出步子。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlFile = path.join(__dirname, '..', 'dist', '中国象棋.html');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const html = fs.readFileSync(htmlFile, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
ok(scripts.length === 1, `内联脚本块数量为 1（实际 ${scripts.length}）`);
const code = scripts[scripts.length - 1][1];
ok(code.length > 20000, `bundle 体积合理（${(code.length / 1024).toFixed(1)} KB）`);

ok(!/<script[^>]*src=/.test(html), '没有外链 script（完全自包含）');
ok(!/<link[^>]*stylesheet/.test(html), '没有外链样式（完全自包含）');

// ---- DOM stub ----
const handlers = {};
const els = {};
const gradient = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

function makeEl(id) {
  const el = {
    id, hidden: false, textContent: '', innerHTML: '', scrollTop: 0, scrollHeight: 800,
    style: {}, dataset: {}, width: 900, height: 1000,
    _handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
    },
    addEventListener(t, fn) { (el._handlers[t] ||= []).push(fn); (handlers[id + ':' + t] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (el._handlers[e.type] || []).forEach(fn => fn(e)); return true; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 1000, right: 900, bottom: 1000 }; },
    getContext() { return ctxStub; },
    appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  };
  return el;
}

const ids = ['board','statusLine','thinking','turnText','turnBadge','checkWarn','moveList',
  'aiMeta','overlay','ovTitle','ovText','ovNew','btnNew','btnUndo','modeGroup','diffGroup',
  'difficultyGroup','colorGroup','colorPick'];
for (const id of ids) els[id] = makeEl(id);

function mkBtn(ds, active) {
  const b = makeEl('b' + JSON.stringify(ds));
  b.dataset = ds;
  if (active) b.classList.add('active');
  b.closest = (s) => (s === 'button' ? b : null);
  return b;
}
els.modeGroup._sub = [mkBtn({ mode: 'pve' }, true), mkBtn({ mode: 'pvp' })];
els.diffGroup._sub = [mkBtn({ diff: 'easy' }), mkBtn({ diff: 'normal' }, true), mkBtn({ diff: 'hard' }), mkBtn({ diff: 'master' })];
els.colorPick._sub = [mkBtn({ side: 'r' }, true), mkBtn({ side: 'b' })];

const documentStub = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  querySelector: (s) => (s === '#turnBadge .dot' ? makeEl('dot') : makeEl('q')),
  querySelectorAll: (s) => {
    if (s === '#modeGroup button') return els.modeGroup._sub;
    if (s === '#diffGroup button') return els.diffGroup._sub;
    if (s === '#colorPick button') return els.colorPick._sub;
    return [];
  },
  addEventListener() {},
  createElement: () => makeEl('created'),
  title: '中国象棋',
};

const sandbox = {
  document: documentStub,
  window: { addEventListener() {} },
  performance: { now: () => Date.now() },
  MouseEvent: class { constructor(t, o = {}) { this.type = t; Object.assign(this, o); } },
  setTimeout, clearTimeout, setInterval, clearInterval,
  console, Math, Date, JSON, Array, Object, Number, String, Boolean, Error, Map, Set, Proxy,
  requestAnimationFrame: (fn) => setTimeout(fn, 16),
  devicePixelRatio: 1,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// ---- 执行 bundle ----
console.log('\n执行单文件 bundle ...');
try {
  const fn = new Function(...Object.keys(sandbox), code);
  fn(...Object.values(sandbox));
  ok(true, 'bundle 完整执行无异常');
} catch (e) {
  ok(false, 'bundle 执行失败: ' + e.message);
  console.log(e.stack);
  process.exit(1);
}

await new Promise(r => setTimeout(r, 120));

ok(els.turnText.textContent.includes('红'), `启动后轮到红方：${els.turnText.textContent}`);
ok(els.statusLine.textContent.length > 0, `状态栏有文字：${els.statusLine.textContent}`);
ok(handlers['board:click'] && handlers['board:click'].length > 0, '棋盘点击已绑定');
ok(handlers['btnNew:click'] && handlers['btnNew:click'].length > 0, '重新开局已绑定');
ok(handlers['btnUndo:click'] && handlers['btnUndo:click'].length > 0, '悔棋已绑定');

// 走一步棋：红兵(0,6) -> (0,5)
const MARGIN = 70, CELL = 88;
const click = (x, y) => {
  const e = new sandbox.MouseEvent('click', { clientX: MARGIN + x * CELL, clientY: MARGIN + y * CELL, bubbles: true });
  els.board.dispatchEvent(e);
};
click(0, 6);
await new Promise(r => setTimeout(r, 40));
click(0, 5);
await new Promise(r => setTimeout(r, 120));

ok(els.moveList.innerHTML.includes('兵'), `走子后记谱显示：${els.moveList.innerHTML.replace(/<[^>]+>/g, '').trim()}`);

console.log(`\n单文件版验证：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
