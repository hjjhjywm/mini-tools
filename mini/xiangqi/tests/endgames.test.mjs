// 验证残局题库：局面是否合法、红方是否有取胜可能
import { Board, RED, BLACK } from '../app/engine.js';
import { ENDGAMES } from '../app/endgames.js';
import { searchBestMove, clearTT } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 残局题库校验 ===\n');

for (const eg of ENDGAMES) {
  console.log(`[${eg.level}] ${eg.name}`);

  let board;
  try {
    board = Board.fromFen(eg.fen);
  } catch (e) {
    ok(false, `FEN 解析失败: ${e.message}`);
    continue;
  }

  // 1. 双方都要有将/帅
  ok(board.findKing(RED) >= 0, '红方有帅');
  ok(board.findKing(BLACK) >= 0, '黑方有将');

  // 2. 红方必须能走（否则直接输了）
  const redMoves = board.legalMoves(RED);
  ok(redMoves.length > 0, `红方有 ${redMoves.length} 种走法`);

  // 3. 局面不能是"红方已被将军却没救"——即红方必须还没输
  const st = board.gameStatus();
  ok(!st.over || st.winner === RED, `开局未被判负（${st.over ? st.winner + '胜·' + st.reason : '进行中'}）`);

  // 4. 红方总得有攻击子力（车/马/炮/兵）
  const redPieces = board.cells.filter(p => p && p === p.toUpperCase());
  const attackers = redPieces.filter(p => 'RNCP'.includes(p));
  ok(attackers.length > 0, `红方有攻击子力（${attackers.join('') || '无'}）`);

  // 5. AI 在这个局面下能找到走法（说明搜索不会崩）
  clearTT();
  const res = searchBestMove(board, { maxDepth: 3, timeLimitMs: 800 });
  ok(res && res.move, 'AI 能在此局面搜索出着法');

  console.log('');
}

// 检查 FEN 是否有重复 id / 名称
const ids = ENDGAMES.map(e => e.id);
ok(new Set(ids).size === ids.length, `残局 id 无重复（共 ${ids.length} 个）`);

console.log(`\n残局校验：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
