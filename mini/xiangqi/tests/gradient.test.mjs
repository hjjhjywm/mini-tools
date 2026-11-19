// 难度梯度验证：相邻两档对打，强档应明显占优
import { Board, RED, BLACK } from '../app/engine.js';
import { chooseMove, clearTT } from '../app/ai.js';

function playOut(a, bCfg, maxPlies = 160) {
  const b = new Board();
  let plies = 0;
  while (plies < maxPlies) {
    const st = b.gameStatus();
    if (st.over) return { winner: st.winner, reason: st.reason, plies };
    clearTT();
    const r = chooseMove(b, b.side === RED ? a : bCfg);
    if (!r || !r.move) return { winner: null, reason: '无着', plies };
    b.makeMove(r.move);
    plies++;
  }
  return { winner: null, reason: '超步数', plies };
}

const PAIRS = [
  ['normal', 'easy', '普通 vs 入门'],
  ['hard', 'normal', '困难 vs 普通'],
  ['master', 'hard', '大师 vs 困难'],
];

console.log('=== 难度梯度（每对 4 局，红黑轮换）===\n');

for (const [strong, weak, label] of PAIRS) {
  let strongWins = 0, weakWins = 0, draws = 0;
  // 轮换执子，消除先手优势
  for (let i = 0; i < 4; i++) {
    const strongIsRed = i % 2 === 0;
    const r = strongIsRed ? playOut(strong, weak) : playOut(weak, strong);
    if (r.winner === null) draws++;
    else if ((r.winner === RED) === strongIsRed) strongWins++;
    else weakWins++;
  }
  const rate = (strongWins / 4 * 100).toFixed(0);
  const flag = strongWins >= 3 ? '✓' : (strongWins >= 2 ? '⚠' : '✗');
  console.log(`  ${label}: 强档 ${strongWins} 胜 / 弱档 ${weakWins} 胜 / 和 ${draws}  → 强档胜率 ${rate}%  ${flag}`);
}
