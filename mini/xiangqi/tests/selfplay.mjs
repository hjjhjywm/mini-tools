import { Board, RED, BLACK } from '../app/engine.js';
import { chooseMove, clearTT } from '../app/ai.js';

const b = new Board();
let ply = 0;
const t0 = Date.now();

while (ply < 120) {
  const st = b.gameStatus();
  if (st.over) {
    console.log(`\n对局结束于第 ${ply} 步：${st.winner === RED ? '红方' : '黑方'}胜（${st.reason}）`);
    break;
  }
  const mv = chooseMove(b, 'easy'); // 简单难度自对弈，快速验证
  if (!mv || !mv.move) { console.log('无着可走'); break; }
  b.makeMove(mv.move);
  ply++;
  if (ply % 20 === 0) {
    const redMat = b.cells.filter(p => p && p === p.toUpperCase()).length;
    const blackMat = b.cells.filter(p => p && p !== p.toUpperCase()).length;
    console.log(`第 ${ply} 步 · 红子 ${redMat} 黑子 ${blackMat} · ${Date.now() - t0}ms`);
  }
}
console.log(`\n总步数 ${ply}，耗时 ${Date.now() - t0}ms`);
console.log('最终 FEN:', b.toFen());

// 验证历史栈可完整回退
const fenEnd = b.toFen();
let n = 0;
while (b.history.length > 0) { b.undo(); n++; }
console.log(`回退 ${n} 步后 FEN:`, b.toFen());
console.log(b.toFen() === 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r' ? '✓ 完整回退到起始局面' : '✗ 回退异常');
