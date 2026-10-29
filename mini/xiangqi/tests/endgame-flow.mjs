// 残局模式的完整流程验证：载入残局 → 走子 → 步数统计 → 胜负判定
import { Board, RED, BLACK } from '../app/engine.js';
import { ENDGAMES } from '../app/endgames.js';
import { chooseMove } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 残局模式流程验证 ===\n');

// 1. 每个残局都能从 FEN 正确载入，且玩家执红先手
for (const eg of ENDGAMES) {
  const b = Board.fromFen(eg.fen);
  ok(b.side === RED, `${eg.name}: 红方先手`);
  ok(b.findKing(RED) >= 0 && b.findKing(BLACK) >= 0, `${eg.name}: 双方将帅都在`);
}

// 2. 步数限制：正常对局不会一开局就超出
for (const eg of ENDGAMES) {
  ok(eg.goal.maxMoves >= 40, `${eg.name}: 步数上限 ${eg.goal.maxMoves} 步充足`);
}

// 3. 残局实际对战不会走出"非法着法"
console.log('\n实战争验：');
for (const eg of ENDGAMES) {
  const b = Board.fromFen(eg.fen);
  let plies = 0;
  let illegal = false;
  while (plies < eg.goal.maxMoves * 2) {
    const st = b.gameStatus();
    if (st.over) break;
    const legal = b.legalMoves(b.side);
    const diff = b.side === RED ? 'hard' : 'easy';
    const r = chooseMove(b, diff);
    if (!r || !r.move) break;
    // 校验这一着是否在合法列表里
    const found = legal.some(m =>
      m.from[0] === r.move.from[0] && m.from[1] === r.move.from[1] &&
      m.to[0] === r.move.to[0] && m.to[1] === r.move.to[1]);
    if (!found) { illegal = true; break; }
    b.makeMove(r.move);
    plies++;
  }
  ok(!illegal, `${eg.name}: 全程无非法着法（${plies} 步）`);
}

// 4. 残局失败情形：红方乱走时，只要不送车，黑将也吃不掉它 ——
//    对局可能一直不结束，这属于正常情况（残局靠"限步内取胜"判定，不是必须分胜负）。
//    这里只验证：乱走不会导致棋盘进入非法状态。
{
  const eg = ENDGAMES[0];
  const b = Board.fromFen(eg.fen);
  let plies = 0;
  let crashed = false;
  try {
    while (plies < eg.goal.maxMoves * 2) {
      const st = b.gameStatus();
      if (st.over) break;
      const r = chooseMove(b, b.side === RED ? 'easy' : 'hard');
      if (!r || !r.move) break;
      b.makeMove(r.move);
      plies++;
    }
  } catch (e) {
    crashed = true;
  }
  ok(!crashed, `红方乱走时引擎不崩溃（走了 ${plies} 步）`);
  // 棋盘状态仍合法：双方将帅都在，或已分胜负
  const redKing = b.findKing(RED) >= 0;
  const blackKing = b.findKing(BLACK) >= 0;
  ok(redKing && blackKing, '对局中双方将帅始终存在（未出现非法吃子）');
}

console.log(`\n残局流程：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
