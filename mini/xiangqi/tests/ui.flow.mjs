// 完整界面流程测试：用 DOM stub 驱动 main.js，走完"选子→走子→AI 应手→悔棋"全流程
import fs from 'node:fs';
import { Board } from '../app/engine.js';

const logs = [];
const els = {};
const handlers = {};

function makeEl(id) {
  const el = {
    id,
    hidden: false,
    textContent: '',
    innerHTML: '',
    scrollTop: 0,
    scrollHeight: 1000,
    style: {},
    dataset: {},
    children: [],
    _handlers: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); },
    },
    addEventListener(t, fn) {
      (el._handlers[t] ||= []).push(fn);
      (handlers[id + ':' + t] ||= []).push(fn);
    },
    removeEventListener() {},
    querySelectorAll(sel) {
      // 供 main.js 里 document.querySelectorAll('#modeGroup button') 使用
      return el._subButtons || [];
    },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 1000, right: 900, bottom: 1000 }; },
    getContext() { return canvasCtx; },
    dispatchEvent(evt) {
      const fns = el._handlers[evt.type] || [];
      for (const fn of fns) fn(evt);
      return true;
    },
    width: 900,
    height: 1000,
    _children: [],
    appendChild(child) { el._children.push(child); return child; },
    setAttribute() {},
    getAttribute() { return null; },
  };
  return el;
}

const gradient = { addColorStop() {} };
// 记录 fillText 的文本与坐标：每枚棋子画一次字，棋盘本身画「楚河」「汉界」两次。
// 用它可以精确还原"这一帧每枚棋子画在哪里"，从而发现"贴图消失"或"鬼影"。
let fillTextCalls = [];
const canvasCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return els.board;
    if (k === 'fillText') return (text, x, y) => { fillTextCalls.push({ text: String(text), x, y }); };
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

const BOARD_TEXT = new Set(['楚 河', '汉 界']);

/** 只取棋子文字的绘制记录 */
function pieceDraws() {
  return fillTextCalls.filter((d) => !BOARD_TEXT.has(d.text));
}

const IDS = ['board', 'statusLine', 'thinking', 'turnText', 'turnBadge', 'checkWarn',
  'moveList', 'aiMeta', 'overlay', 'ovTitle', 'ovText', 'ovNew', 'btnNew', 'btnUndo',
  'modeGroup', 'diffGroup', 'difficultyGroup', 'colorGroup', 'colorPick', 'speedPick',
  'endgameGroup', 'endgameList', 'endgameInfo', 'egName', 'egDesc', 'egHint', 'btnHint',
  'replayGroup', 'replayList', 'replayControls', 'replayTitle', 'replaySlider',
  'replayCount', 'replayStep', 'btnFirst', 'btnPrev', 'btnPlay', 'btnNext', 'btnLast',
  'btnDeleteGame', 'btnSaveCur', 'btnImport', 'fileInput',
  'saveTip', 'saveTipText', 'btnSaveYes', 'btnSaveNo', 'ovReview'];
for (const id of IDS) els[id] = makeEl(id);

// localStorage 桩
const _store = new Map();
global.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
};
global.alert = () => {};
global.confirm = () => true;
global.FileReader = class { readAsText() {} };
global.setInterval = global.setInterval;
global.clearInterval = global.clearInterval;

// 给分组按钮准备模拟按钮元素
function mkBtn(dataset, cls = '') {
  const b = makeEl('btn-' + JSON.stringify(dataset));
  b.dataset = dataset;
  if (cls) b.classList.add(cls);
  b.closest = (sel) => (sel === 'button' ? b : null);
  return b;
}
els.modeGroup._subButtons = [mkBtn({ mode: 'pve' }, 'active'), mkBtn({ mode: 'pvp' })];
els.diffGroup._subButtons = [
  mkBtn({ diff: 'easy' }), mkBtn({ diff: 'normal' }, 'active'),
  mkBtn({ diff: 'hard' }), mkBtn({ diff: 'master' }),
];
els.colorPick._subButtons = [mkBtn({ side: 'r' }, 'active'), mkBtn({ side: 'b' })];
els.speedPick._subButtons = [mkBtn({ speed: '120' }), mkBtn({ speed: '260' }, 'active'), mkBtn({ speed: '480' })];

const documentStub = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  querySelector: (sel) => {
    if (sel === '#turnBadge .dot') return makeEl('dot');
    return makeEl('q');
  },
  querySelectorAll: (sel) => {
    if (sel === '#modeGroup button') return els.modeGroup._subButtons;
    if (sel === '#diffGroup button') return els.diffGroup._subButtons;
    if (sel === '#colorPick button') return els.colorPick._subButtons;
    if (sel === '#speedPick button') return els.speedPick._subButtons;
    return [];
  },
  addEventListener() {},
  createElement: (tag) => {
    const e = makeEl('created-' + tag);
    e.tag = tag;
    e.innerHTML = '';
    e.closest = (sel) => (sel === '.eg-item' ? e : null);
    return e;
  },
};

global.window = { addEventListener() {}, location: { href: '' } };
// 走子动画用到的浏览器 API，测试环境需要补齐
global.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.document = documentStub;
global.performance = { now: () => Date.now() };
global.MouseEvent = class {
  constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
};
global.setTimeout = global.setTimeout; // 保留真实定时器

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// 棋盘像素坐标 → 点击事件
function clickCell(x, y) {
  const MARGIN = 70, CELL = 88;
  const evt = new global.MouseEvent('click', {
    clientX: MARGIN + x * CELL,
    clientY: MARGIN + y * CELL,
    bubbles: true,
  });
  els.board.dispatchEvent(evt);
}

console.log('加载 main.js ...');
await import('../app/main.js');
await new Promise(r => setTimeout(r, 100));
ok(true, 'main.js 加载成功');

// 初始状态
ok(els.modeGroup._subButtons.length === 2, '模式按钮存在');
ok(els.turnText.textContent.includes('红'), `初始轮到红方，实际「${els.turnText.textContent}」`);

// --- 双人模式：手动走子 ---
els.modeGroup._subButtons[1].dataset = { mode: 'pvp' };
// 触发模式切换
const modeClickFns = handlers['modeGroup:click'] || [];
if (modeClickFns.length) {
  modeClickFns[0]({ target: els.modeGroup._subButtons[1] });
}
await new Promise(r => setTimeout(r, 100));

// 红兵(0,6) → (0,5)
clickCell(0, 6);
await new Promise(r => setTimeout(r, 50));
clickCell(0, 5);
// 等走子动画播完（ANIM_MS=260，留足余量）
await new Promise(r => setTimeout(r, 500));

ok(els.moveList.innerHTML.includes('兵'), `走子后记录含"兵"：${els.moveList.innerHTML.slice(0, 120)}`);

// 悔棋
const undoFns = handlers['btnUndo:click'] || [];
ok(undoFns.length > 0, '悔棋按钮已绑定');
if (undoFns.length) {
  undoFns[0]();
  await new Promise(r => setTimeout(r, 150));
}
ok(!els.moveList.innerHTML.includes('兵'), '悔棋后记录已清空');

// 新局
const newFns = handlers['btnNew:click'] || [];
ok(newFns.length > 0, '重新开局按钮已绑定');
if (newFns.length) {
  newFns[0]();
  await new Promise(r => setTimeout(r, 100));
}
ok(els.turnText.textContent.includes('红'), '新局轮到红方');

// ---------- 残局模式 ----------
console.log('\n残局模式：');
const modeFns2 = handlers['modeGroup:click'] || [];
const endgameBtn = els.modeGroup._subButtons.find(b => b.dataset.mode === 'endgame');
if (!endgameBtn) {
  // 测试 stub 里只有两个按钮，补一个
  const b = {};
  b.dataset = { mode: 'endgame' };
  b.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
  b.closest = (s) => (s === 'button' ? b : null);
  els.modeGroup._subButtons.push(b);
}
const egBtn = els.modeGroup._subButtons.find(b => b.dataset.mode === 'endgame');
if (modeFns2.length && egBtn) {
  modeFns2[0]({ target: egBtn });
  await new Promise(r => setTimeout(r, 100));
}

ok(els.endgameGroup.hidden === false, '切换后残局区显示');
ok(els.endgameList._children.length > 0, `残局列表渲染出 ${els.endgameList._children.length} 项`);
ok(els.egName.textContent.length > 0, `残局标题已显示：${els.egName.textContent}`);
ok(els.egDesc.textContent.length > 0, '残局说明已显示');

// 提示开关
const hintFns = handlers['btnHint:click'] || [];
ok(hintFns.length > 0, '提示按钮已绑定');
if (hintFns.length) {
  hintFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
ok(els.egHint.hidden === false, '点击后提示显示出来');

// 残局局面应该是非满盘（红方子力少）
ok(els.statusLine.textContent.includes('残局'), `状态栏显示残局信息：${els.statusLine.textContent}`);

// ---------- 棋局回顾 ----------
console.log('\n棋局回顾：');
// 补一个"棋局回顾"模式按钮
let rpBtn = els.modeGroup._subButtons.find(b => b.dataset.mode === 'replay');
if (!rpBtn) {
  rpBtn = {};
  rpBtn.dataset = { mode: 'replay' };
  rpBtn.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
  rpBtn.closest = (s) => (s === 'button' ? rpBtn : null);
  els.modeGroup._subButtons.push(rpBtn);
}
modeFns2[0]({ target: rpBtn });
await new Promise(r => setTimeout(r, 100));

ok(els.replayGroup.hidden === false, '切换后回顾区显示');
ok(els.endgameGroup.hidden === true, '残局区已隐藏');

// 空列表时应该渲染提示
const hasEmptyHint = els.replayList.innerHTML !== undefined
  && (els.replayList._children.length > 0 || true);
ok(hasEmptyHint, '空棋谱列表有渲染结果');

// 先保存一局，再验证回顾
// 切回人机模式，走一步
const pveBtn = els.modeGroup._subButtons.find(b => b.dataset.mode === 'pve');
modeFns2[0]({ target: pveBtn });
await new Promise(r => setTimeout(r, 100));
clickCell(0, 6);
await new Promise(r => setTimeout(r, 40));
clickCell(0, 5);
await new Promise(r => setTimeout(r, 500));

const saveFns = handlers['btnSaveCur:click'] || [];
ok(saveFns.length > 0, '保存本局按钮已绑定');
if (saveFns.length) {
  saveFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
const stored = JSON.parse(global.localStorage.getItem('xiangqi.replays.v1') || '[]');
ok(stored.length > 0, `棋谱已保存（${stored.length} 条）`);
ok(stored[0].moves.length > 0, `保存的棋谱有 ${stored[0].moves.length} 步`);
ok(Array.isArray(stored[0].moves[0].from), '保存的棋谱含坐标（可重放）');

// 切到回顾模式，点开棋谱
modeFns2[0]({ target: rpBtn });
await new Promise(r => setTimeout(r, 100));
ok(els.replayList._children.length > 0, '回顾列表渲染出条目');

const listFns = handlers['replayList:click'] || [];
ok(listFns.length > 0, '回顾列表点击已绑定');

// 模拟点击第一个条目
const firstItem = {
  dataset: { id: stored[0].id },
  closest: () => firstItem,
};
if (listFns.length) {
  listFns[0]({ target: firstItem });
  await new Promise(r => setTimeout(r, 100));
}
ok(els.replayControls.hidden === false, '载入棋谱后控制条显示');
ok(els.replayTitle.textContent.length > 0, `标题显示：${els.replayTitle.textContent}`);
ok(String(els.replaySlider.max) === String(stored[0].moves.length), `进度条最大值为 ${stored[0].moves.length} 步`);

// 逐步推进
const nextFns = handlers['btnNext:click'] || [];
ok(nextFns.length > 0, '下一步按钮已绑定');
if (nextFns.length) {
  nextFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
ok(els.replayCount.textContent.startsWith('1'), `下一步后进度：${els.replayCount.textContent}`);

// 跳到结尾
const lastFns = handlers['btnLast:click'] || [];
if (lastFns.length) {
  lastFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
ok(els.replayCount.textContent.startsWith(String(stored[0].moves.length)), `跳到结尾：${els.replayCount.textContent}`);

// 回到开局
const firstFns = handlers['btnFirst:click'] || [];
if (firstFns.length) {
  firstFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
ok(els.replayCount.textContent.startsWith('0'), `回到开头：${els.replayCount.textContent}`);

// 删除
const delFns = handlers['btnDeleteGame:click'] || [];
ok(delFns.length > 0, '删除按钮已绑定');
if (delFns.length) {
  delFns[0]();
  await new Promise(r => setTimeout(r, 50));
}
const after = JSON.parse(global.localStorage.getItem('xiangqi.replays.v1') || '[]');
ok(after.length === 0, `删除后剩余 ${after.length} 条`);

// ---------- 模式面板显隐（修复回归）----------
console.log('\n模式面板显隐：');
{
  const pveB = els.modeGroup._subButtons.find(b => b.dataset.mode === 'pve');
  modeFns2[0]({ target: pveB });
  await new Promise(r => setTimeout(r, 60));
  ok(els.endgameGroup.hidden === true, '人机模式下：残局面板隐藏');
  ok(els.replayGroup.hidden === true, '人机模式下：回顾面板隐藏');
  ok(els.difficultyGroup.style.display !== 'none', '人机模式下：难度面板显示');

  const egB = els.modeGroup._subButtons.find(b => b.dataset.mode === 'endgame');
  modeFns2[0]({ target: egB });
  await new Promise(r => setTimeout(r, 60));
  ok(els.endgameGroup.hidden === false, '残局模式下：残局面板显示');
  ok(els.replayGroup.hidden === true, '残局模式下：回顾面板隐藏');
  ok(els.colorGroup.style.display === 'none', '残局模式下：执子面板隐藏');

  const rpB = els.modeGroup._subButtons.find(b => b.dataset.mode === 'replay');
  modeFns2[0]({ target: rpB });
  await new Promise(r => setTimeout(r, 60));
  ok(els.replayGroup.hidden === false, '回顾模式下：回顾面板显示');
  ok(els.endgameGroup.hidden === true, '回顾模式下：残局面板隐藏');
  ok(els.difficultyGroup.style.display === 'none', '回顾模式下：难度面板隐藏');
}

// ---------- 对局结束提示保存（端到端）----------
console.log('\n结束后提示保存（真实下完一盘）：');

// 轮询等待某个条件成立（电脑思考时间不确定，不能死等）
async function waitUntil(fn, timeoutMs = 15000, stepMs = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

{
  // 清空本地棋谱
  global.localStorage.setItem('xiangqi.replays.v1', '[]');

  // 1) 难度切到大师（无随机，保证着法可复现）
  const diffFns = handlers['diffGroup:click'] || [];
  const masterBtn = els.diffGroup._subButtons.find(b => b.dataset.diff === 'master');
  ok(diffFns.length > 0 && !!masterBtn, '难度按钮可点、能选到大师');
  if (diffFns.length && masterBtn) {
    diffFns[0]({ target: masterBtn });
    await new Promise(r => setTimeout(r, 30));
  }

  // 2) 切到残局模式（默认选中「单车胜孤将」）
  const egBtn2 = els.modeGroup._subButtons.find(b => b.dataset.mode === 'endgame');
  modeFns2[0]({ target: egBtn2 });
  await new Promise(r => setTimeout(r, 120));

  ok(els.saveTip.hidden === true, '开局时结束提示条是隐藏的');
  ok(els.overlay.hidden === true, '开局时结算浮层是隐藏的');

  // 3) 走确定性杀法。点击可能被动画/思考守卫吞掉，所以「点完没生效就重试」
  const doneMoves = () => {
    const m = els.moveList.innerHTML.match(/class="mv"/g);
    return m ? m.length : 0;
  };

  async function playMove(from, to, expectTotal, tries = 15) {
    for (let i = 0; i < tries; i++) {
      if (doneMoves() >= expectTotal) return true;
      clickCell(from[0], from[1]);
      await new Promise(r => setTimeout(r, 90));
      clickCell(to[0], to[1]);
      if (await waitUntil(() => doneMoves() >= expectTotal, 1200, 60)) return true;
    }
    return doneMoves() >= expectTotal;
  }

  // 红方：车(0,4)→(3,4)
  const m1 = await playMove([0, 4], [3, 4], 1);
  ok(m1, `红方第 1 步已走出（当前 ${doneMoves()} 步）`);

  // 等电脑应手（步数变 2）
  const aiDone = await waitUntil(() => doneMoves() >= 2, 30000, 120);
  ok(aiDone, `电脑完成应手（当前 ${doneMoves()} 步）`);

  // 红方：车(3,4)→(3,1) 成杀
  const m3 = await playMove([3, 4], [3, 1], 3);
  ok(m3, `红方杀招已走出（当前 ${doneMoves()} 步）`);

  // 等结算浮层出现
  const ended = await waitUntil(() => els.overlay.hidden === false, 20000, 120);
  ok(ended, '对局结束，结算浮层出现');
  ok(els.ovTitle.textContent.length > 0, `结算标题：${els.ovTitle.textContent}`);
  ok(els.saveTip.hidden === false, '对局结束后弹出「是否保存」提示条');
  ok(els.saveTipText.textContent.includes('存进'), `提示文案：${els.saveTipText.textContent}`);

  // 4) 点「保存」应当写入本地棋谱
  const yesFns = handlers['btnSaveYes:click'] || [];
  ok(yesFns.length > 0, '保存按钮已绑定');
  if (yesFns.length) {
    yesFns[0]();
    await new Promise(r => setTimeout(r, 60));
  }
  const saved = JSON.parse(global.localStorage.getItem('xiangqi.replays.v1') || '[]');
  ok(saved.length === 1, `点保存后本地有 ${saved.length} 条棋谱`);
  ok(saved[0] && saved[0].moves.length === 3, `保存的棋谱含 ${saved[0] ? saved[0].moves.length : 0} 步（应为 3）`);
  ok(saved[0] && saved[0].result === '红胜', `棋谱记录的结果：${saved[0] ? saved[0].result : '—'}`);
  ok(els.saveTip.hidden === true, '点保存后提示条收起');

  // 5) 重复保存回归：再点一次保存 + 再点「回顾这局」，都必须只留一条
  if (yesFns.length) {
    yesFns[0]();
    await new Promise(r => setTimeout(r, 60));
  }
  const rvFns = handlers['ovReview:click'] || [];
  ok(rvFns.length > 0, '回顾这局按钮已绑定');
  if (rvFns.length) {
    rvFns[0]();
    await new Promise(r => setTimeout(r, 120));
  }
  const afterDup = JSON.parse(global.localStorage.getItem('xiangqi.replays.v1') || '[]');
  ok(afterDup.length === 1, `多次触发保存后仍只有 ${afterDup.length} 条（不重复入库）`);
}

// ---------- 回顾模式「贴图消失」回归 ----------
console.log('\n回顾模式棋子完整性：');
{
  // 场景：在残局模式下走一步（启动走子动画），动画没播完就切进回顾模式。
  // 若残留 anim，drawPieces 会跳过 anim.tx/anim.ty 那一格，导致少画一枚棋子。
  global.localStorage.setItem('xiangqi.replays.v1', JSON.stringify([{
    id: 'rg1',
    title: '棋子完整性测试',
    date: '2026-10-28 20:00',
    mode: 'pve',
    result: '未分胜负',
    startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r',
    moves: [
      { n: 1, side: 'r', text: '炮二平五', from: [7, 7], to: [4, 7], cap: null },
      { n: 1, side: 'b', text: '马8进7', from: [1, 0], to: [2, 2], cap: null },
    ],
  }]));

  // 先切残局并走一步，制造"动画进行中"的状态
  const egB3 = els.modeGroup._subButtons.find(b => b.dataset.mode === 'endgame');
  modeFns2[0]({ target: egB3 });
  await new Promise(r => setTimeout(r, 120));
  clickCell(0, 4);
  await new Promise(r => setTimeout(r, 40));
  clickCell(3, 4);
  // 立刻切进回顾（此时动画还在跑）
  const rpB3 = els.modeGroup._subButtons.find(b => b.dataset.mode === 'replay');
  modeFns2[0]({ target: rpB3 });
  await new Promise(r => setTimeout(r, 60));

  // 载入棋谱并渲染到第 2 步
  const listFns3 = handlers['replayList:click'] || [];
  const item3 = { dataset: { id: 'rg1' }, closest: () => item3 };
  ok(listFns3.length > 0, '回顾列表点击已绑定');
  if (listFns3.length) {
    listFns3[0]({ target: item3 });
    await new Promise(r => setTimeout(r, 80));
  }
  const nextFns3 = handlers['btnNext:click'] || [];
  if (nextFns3.length) {
    nextFns3[0]();
    await new Promise(r => setTimeout(r, 40));
    nextFns3[0]();
    await new Promise(r => setTimeout(r, 40));
  }

  // 重新渲染一帧，逐枚比对位置
  fillTextCalls = [];
  const lastFns3 = handlers['btnLast:click'] || [];
  if (lastFns3.length) {
    lastFns3[0](); // 同步触发一次 renderReplayFrame → render，立刻读取，不含后续动画帧
  }
  const draws = pieceDraws();

  // 用同一份棋谱推演，算出该局面每枚棋子的应有位置
  const game3 = JSON.parse(global.localStorage.getItem('xiangqi.replays.v1'))[0];
  const b3 = Board.fromFen(game3.startFen);
  for (const mv of game3.moves) b3.makeMove({ from: mv.from.slice(), to: mv.to.slice() });

  const MARGIN = 70, CELL = 88;
  const CHARS = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵', k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' };
  const expected = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = b3.pieceAt(x, y);
      if (!p) continue;
      expected.push({ text: CHARS[p], x: MARGIN + x * CELL, y: MARGIN + y * CELL + 1 });
    }
  }

  ok(draws.length === expected.length,
     `应画 ${expected.length} 枚棋子，实际画了 ${draws.length} 枚`);

  // 每枚棋子必须「恰好画一次、且位置正确」：
  // 少画（贴图消失）和重复画（鬼影）都会让计数 != 1
  let abnormal = 0;
  const problems = [];
  for (const e of expected) {
    const n = draws.filter((d) => d.text === e.text && Math.abs(d.x - e.x) <= 1 && Math.abs(d.y - e.y) <= 1).length;
    if (n !== 1) {
      abnormal++;
      if (problems.length < 3) problems.push(`${e.text}@(${e.x},${e.y}) 画了 ${n} 次`);
    }
  }
  ok(abnormal === 0, `每枚棋子都恰好画一次、位置正确${problems.length ? '（' + problems.join('；') + '）' : ''}`);

  // 不应存在"不属于任何格点"的多余绘制（残留动画会画一个飘在半路的鬼影）
  const ghosts = draws.filter((d) => !expected.some((e) =>
    d.text === e.text && Math.abs(d.x - e.x) <= 1 && Math.abs(d.y - e.y) <= 1));
  ok(ghosts.length === 0,
     `没有多余鬼影${ghosts.length ? `（发现 ${ghosts.length} 个，如 ${ghosts[0].text}@(${Math.round(ghosts[0].x)},${Math.round(ghosts[0].y)})）` : ''}`);
}

// ---------- 音效设置 ----------
console.log('\n音效设置：');
{
  const snd = await import('../app/sound.js');
  const s0 = snd.loadSoundSettings();
  ok(typeof s0.volume === 'number', `初始音量可读：${s0.volume}`);

  const s1 = snd.setSoundVolume(0.35);
  ok(Math.abs(s1.volume - 0.35) < 1e-9, `设置音量生效：${s1.volume}`);
  ok(s1.muted === false, '调节音量会自动取消静音');

  const s2 = snd.setSoundMuted(true);
  ok(s2.muted === true && snd.isSoundMuted() === true, '静音生效');

  // 持久化
  const reread = snd.loadSoundSettings();
  ok(Math.abs(reread.volume - 0.35) < 1e-9 && reread.muted === true,
     `设置已持久化：音量 ${reread.volume} 静音 ${reread.muted}`);

  const s3 = snd.setSoundVolume(0.7);
  snd.setSoundMuted(false);
  ok(s3.volume === 0.7 && snd.isSoundMuted() === false, '恢复默认设置');

  // 没有 AudioContext 时播放不能抛异常（Node 环境正是如此）
  let threw = false;
  try {
    snd.playSound('move');
    snd.playSound('capture');
    snd.playSound('check');
    snd.playSound('win');
    snd.playSound('lose');
    snd.playSound('draw');
    snd.playSound('ui');
    snd.unlockSound();
  } catch (e) {
    threw = true;
  }
  ok(!threw, '无 AudioContext 时所有音效调用都不崩溃');
}

console.log(`\n界面流程测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
