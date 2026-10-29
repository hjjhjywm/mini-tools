// 验证残局可解性：让 AI 执红、AI 执黑对打，看红方能否取胜
import { Board, RED, BLACK } from '../app/engine.js';
import { ENDGAMES } from '../app/endgames.js';
import { chooseMove, clearTT } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 残局可解性（红方 AI 对黑方 AI 实战）===\n');

for (const eg of ENDGAMES) {
  const board = Board.fromFen(eg.fen);
  let plies = 0;
  let result = null;
  const maxPlies = eg.goal.maxMoves * 2;

  while (plies < maxPlies) {
    const st = board.gameStatus();
    if (st.over) { result = st; break; }
    // 红方用难度高的，黑方用难度低的（模拟玩家执红占优）
    const diff = board.side === RED ? 'hard' : 'easy';
    const r = chooseMove(board, diff);
    if (!r || !r.move) { result = { over: true, winner: null, reason: '无着' }; break; }
    board.makeMove(r.move);
    plies++;
  }

  const win = result && result.winner === RED;
  console.log(`[${eg.level}] ${eg.name}`);
  console.log(`    结果: ${result ? (result.over ? (result.winner === RED ? '红胜' : result.winner === BLACK ? '黑胜' : '和') + '·' + result.reason : '超时') : '超过步数上限'}  用了 ${plies} 步`);
  ok(win, `红方能够取胜（${eg.name}）`);
  console.log('');
}

console.log(`\n残局可解性：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
