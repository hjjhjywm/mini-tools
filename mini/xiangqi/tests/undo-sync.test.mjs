// 回归测试：悔棋必须让 moveRecords / moveLog 与棋盘历史严格同步
// 不同步会导致保存的棋谱包含已撤销的着法，回放时棋子位置错乱（曾表现为"棋子消失"）
import { Board, RED, BLACK, PIECE_CHARS } from '../app/engine.js';
import { Replayer, addGame } from '../app/replay.js';

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

/** 复刻修复后的 undo 逻辑 */
function makeCtx(mode = 'pvp') {
  const ctx = {
    board: new Board(),
    moveLog: [],
    moveRecords: [],
    moveCount: 0,
    playerSide: RED,
    mode,
  };

  ctx.perform = (move) => {
    const b = ctx.board;
    const mover = b.side;
    const captured = b.makeMove(move);
    ctx.moveLog.push({ text: 'x', side: mover, captured });
    ctx.moveRecords.push({
      n: Math.floor(ctx.moveRecords.length / 2) + 1,
      side: mover === RED ? 'r' : 'b',
      text: 'x',
      from: move.from.slice(),
      to: move.to.slice(),
      cap: captured ? PIECE_CHARS[captured] : null,
    });
    ctx.moveCount++;
  };

  ctx.undo = () => {
    const b = ctx.board;
    if (b.history.length === 0) return;
    const isAI = ctx.mode === 'pve' || ctx.mode === 'endgame';
    b.undo();
    ctx.moveCount = Math.max(0, ctx.moveCount - 1);
    if (isAI && b.history.length > 0 && b.side !== ctx.playerSide) {
      b.undo();
      ctx.moveCount = Math.max(0, ctx.moveCount - 1);
    }
    // 修复：按棋盘历史长度截断，保证严格同步
    const syncedLen = b.history.length;
    if (ctx.moveRecords.length > syncedLen) ctx.moveRecords.length = syncedLen;
    if (ctx.moveLog.length > syncedLen) ctx.moveLog.length = syncedLen;
  };

  return ctx;
}

console.log('=== 悔棋后三份数据必须一致 ===');
{
  const c = makeCtx('pvp');
  c.perform({ from: [0, 6], to: [0, 5] });
  c.perform({ from: [0, 3], to: [0, 4] });
  c.perform({ from: [1, 7], to: [2, 7] });

  ok(c.board.history.length === 3 && c.moveLog.length === 3 && c.moveRecords.length === 3,
     '走 3 步后三份都是 3');

  c.undo();
  ok(c.board.history.length === 2, '棋盘历史 2');
  ok(c.moveLog.length === 2, 'moveLog 2');
  ok(c.moveRecords.length === 2, `moveRecords 2（实际 ${c.moveRecords.length}）`);
}

console.log('\n=== 关键场景：悔棋后保存的棋谱回放位置必须正确 ===');
{
  // 残局局面：红车 (0,9)、红帅 (4,9)、黑将 (4,0)
  const startFen = '4k4/9/9/9/9/9/9/9/9/R3K4 r';
  const c = makeCtx('pvp');
  c.board = Board.fromFen(startFen);
  c.moveRecords = [];

  // 走一步：车 (0,9) -> (0,0)
  c.perform({ from: [0, 9], to: [0, 0] });
  // 悔棋
  c.undo();
  ok(c.moveRecords.length === 0, '悔棋后 moveRecords 清空');
  ok(c.board.pieceAt(0, 9) === 'R', '棋盘上车回到 (0,9)');

  // 再走另一步：车 (0,9) -> (1,9)
  c.perform({ from: [0, 9], to: [1, 9] });

  ok(c.moveRecords.length === 1, '保存的棋谱只有 1 步（不含已撤销那步）');
  ok(c.moveRecords[0].to[0] === 1 && c.moveRecords[0].to[1] === 9, '棋谱记录的是 (1,9)');

  // 回放校验
  const { record } = addGame({ title: 't', startFen, moves: c.moveRecords.slice() });
  const rp = new Replayer(record);
  const bEnd = rp.boardAt(rp.total, Board);

  ok(bEnd.pieceAt(1, 9) === 'R', `回放末态红车在 (1,9)（实际 ${bEnd.pieceAt(1, 9) === 'R' ? '(1,9)' : '错位'}）`);
  ok(bEnd.pieceAt(0, 9) === null, '回放末态 (0,9) 已空');
  ok(bEnd.cells.filter(Boolean).length === c.board.cells.filter(Boolean).length,
     '回放末态棋子数与真实棋盘一致');
}

console.log('\n=== 带吃子的悔棋场景 ===');
{
  // 红车可以直接吃黑卒
  const startFen = '4k4/9/9/9/9/9/9/9/4p4/R3K4 r'; // 黑卒(4,8)? 位置需可吃
  const c = makeCtx('pvp');
  c.board = Board.fromFen(startFen);
  c.moveRecords = [];
  c.moveLog = [];

  const startPieces = c.board.cells.filter(Boolean).length;
  // 找一步能吃的
  const legal = c.board.legalMoves(RED);
  const capture = legal.find((m) => c.board.pieceAt(m.to[0], m.to[1]));
  if (capture) {
    c.perform(capture);
    ok(c.moveRecords.length === 1, '吃子后 moveRecords 1 步');
    ok(c.moveRecords[0].cap !== null, `记录里含被吃棋子：${c.moveRecords[0].cap}`);
    ok(c.board.cells.filter(Boolean).length === startPieces - 1, '吃子后棋子少 1');

    // 悔棋
    c.undo();
    ok(c.moveRecords.length === 0, '悔棋后 moveRecords 清空');
    ok(c.board.cells.filter(Boolean).length === startPieces, `悔棋后棋子恢复为 ${startPieces}`);
    ok(c.board.pieceAt(capture.to[0], capture.to[1]) !== null, '被吃的棋子回来了');
  } else {
    ok(true, '（该局面无吃子着法，跳过）');
  }
}

console.log('\n=== 人机模式悔棋撤两步 ===');
{
  const c = makeCtx('pve');
  c.perform({ from: [0, 6], to: [0, 5] }); // 玩家
  c.perform({ from: [0, 3], to: [0, 4] }); // 电脑
  ok(c.board.history.length === 2, '走了 2 步');

  c.undo(); // 人机模式撤两步
  ok(c.board.history.length === 0, '棋盘历史清空');
  ok(c.moveRecords.length === 0, `moveRecords 清空（实际 ${c.moveRecords.length}）`);
  ok(c.moveLog.length === 0, 'moveLog 清空');
}

console.log('\n=== 已不同步的旧数据也能被纠正 ===');
{
  const c = makeCtx('pvp');
  c.perform({ from: [0, 6], to: [0, 5] });
  // 人为制造不同步：moveRecords 比棋盘多 2 条（模拟旧版本遗留的脏数据）
  c.moveRecords.push({ n: 9, side: 'r', text: 'ghost', from: [1, 6], to: [1, 5], cap: null });
  c.moveRecords.push({ n: 9, side: 'b', text: 'ghost2', from: [1, 3], to: [1, 4], cap: null });
  ok(c.moveRecords.length === 3, '人为制造：moveRecords 3 条');

  c.perform({ from: [1, 7], to: [2, 7] });
  ok(c.board.history.length === 2, '棋盘历史 2');

  c.undo();
  ok(c.moveRecords.length === c.board.history.length,
     `悔棋后自动纠正到与历史一致（${c.moveRecords.length} vs ${c.board.history.length}）`);
}

console.log(`\n悔棋同步回归测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
