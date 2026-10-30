// 回顾 bug 回归测试：缺 startFen 不崩、残局开局能正确回放
import { Board, RED, BLACK } from '../app/engine.js';
import { Replayer, fromImport, addGame, normalizeFen } from '../app/replay.js';

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

console.log('=== normalizeFen 兜底 ===');
{
  ok(normalizeFen(undefined) === START, 'undefined -> 标准开局');
  ok(normalizeFen(null) === START, 'null -> 标准开局');
  ok(normalizeFen('') === START, '空串 -> 标准开局');
  ok(normalizeFen('   ') === START, '纯空格 -> 标准开局');
  ok(normalizeFen('乱码') === START, '乱码 -> 标准开局');
  ok(normalizeFen('rnbakabnr/9/1c5c1 r') === START, '行数不足 -> 标准开局');
  ok(normalizeFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR') === START,
     '缺走子方 -> 补成红方');
  // 合法残局 FEN 必须原样保留
  const eg = '9/4k4/9/9/R8/9/9/9/9/5K3 r';
  ok(normalizeFen(eg) === eg, '合法残局 FEN 原样保留');
  ok(normalizeFen(eg.replace(' r', ' b')) === eg.replace(' r', ' b'), '黑方先手也保留');
}

console.log('\n=== 导入缺 startFen 不崩溃（bug 1）===');
{
  const json = JSON.stringify({
    title: '缺 startFen',
    moves: [{ n: 1, side: 'r', text: '炮二平五', from: [7, 7], to: [4, 7] }],
  });
  const r = fromImport(json);
  ok(r.ok === true, '导入成功');
  ok(r.game.startFen === START, 'startFen 已补全为标准开局');

  const rp = new Replayer(r.game);
  let threw = false;
  let board = null;
  try { board = rp.boardAt(0, Board); } catch { threw = true; }
  ok(!threw, 'boardAt 不抛错');
  ok(board && board.cells.filter(Boolean).length === 32, '开局是满盘 32 枚');
}

console.log('\n=== Replayer 直接收脏数据也不崩（bug 1 兜底）===');
{
  for (const bad of [undefined, null, '', '乱码']) {
    const rp = new Replayer({ startFen: bad, moves: [] });
    let threw = false;
    let n = 0;
    try { n = rp.boardAt(0, Board).cells.filter(Boolean).length; } catch { threw = true; }
    ok(!threw && n === 32, `startFen=${JSON.stringify(bad)} 时兜底成满盘且不崩`);
  }
}

console.log('\n=== 残局开局能正确回放（bug 2）===');
{
  // 单车胜孤将的残局对局
  const egFen = '9/4k4/9/9/R8/9/9/9/9/5K3 r';
  const egGame = {
    title: '残局对局',
    mode: 'endgame',
    result: '红胜',
    startFen: egFen,
    moves: [
      { n: 1, side: 'r', text: '车九平六', from: [0, 4], to: [3, 4], cap: null },
      { n: 1, side: 'b', text: '将五进一', from: [4, 1], to: [4, 2], cap: null },
    ],
  };

  const rp = new Replayer(egGame);
  ok(rp.playable === true, '残局棋谱可回放');

  const b0 = rp.boardAt(0, Board);
  ok(b0.cells.filter(Boolean).length === 3, `起始局面 3 枚棋子（实际 ${b0.cells.filter(Boolean).length}）`);
  ok(b0.findKing(RED) >= 0 && b0.findKing(BLACK) >= 0, '双方将帅都在');
  ok(b0.pieceAt(0, 4) === 'R', '红车在原位 (0,4)');

  const b1 = rp.boardAt(1, Board);
  ok(b1.pieceAt(3, 4) === 'R', '第 1 步后红车到 (3,4)');
  ok(b1.pieceAt(0, 4) === null, '原位置已空');

  const b2 = rp.boardAt(2, Board);
  ok(b2.pieceAt(4, 2) === 'k', '第 2 步后黑将在 (4,2)');
  ok(b2.cells.filter(Boolean).length === 3, '棋子数仍是 3（无吃子）');

  // 残局 FEN 不该被 normalizeFen 改成满盘
  ok(rp.boardAt(0, Board).cells.filter(Boolean).length !== 32, '残局开局没有被误改成满盘');
}

console.log('\n=== addGame 保存时也校验 startFen ===');
{
  store.clear();
  const { record } = addGame({
    title: '脏数据',
    startFen: null,
    moves: [{ n: 1, side: 'r', text: 'x', from: [0, 0], to: [0, 1] }],
  });
  ok(record.startFen === START, 'addGame 把 null 的 startFen 兜底成标准开局');

  // 合法残局 FEN 不能被改
  const { record: r2 } = addGame({
    title: '残局',
    startFen: '9/4k4/9/9/R8/9/9/9/9/5K3 r',
    moves: [],
  });
  ok(r2.startFen === '9/4k4/9/9/R8/9/9/9/9/5K3 r', 'addGame 保留合法残局 FEN');
}

console.log(`\n回顾 bug 回归测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
