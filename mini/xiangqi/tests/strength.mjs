// 难度评测：让不同档位互相对弈，统计胜率，验证难度梯度是否合理
import { Board, RED, BLACK } from '../app/engine.js';
import { chooseMove, DIFFICULTIES } from '../app/ai.js';

function playGame(diffA, diffB, maxPlies = 200) {
  const b = new Board();
  let ply = 0;
  while (ply < maxPlies) {
    const st = b.gameStatus();
    if (st.over) {
      return { winner: st.winner, reason: st.reason, plies: ply };
    }
    // 红方用 diffA，黑方用 diffB
    const diff = b.side === RED ? diffA : diffB;
    const res = chooseMove(b, diff);
    if (!res || !res.move) break;
    b.makeMove(res.move);
    ply++;
  }
  return { winner: null, reason: '回合上限', plies: ply };
}

function match(diffA, diffB, games) {
  let aWins = 0, bWins = 0, draws = 0;
  for (let i = 0; i < games; i++) {
    const r = playGame(diffA, diffB);
    if (r.winner === RED) aWins++;
    else if (r.winner === BLACK) bWins++;
    else draws++;
  }
  return { aWins, bWins, draws };
}

console.log('=== 难度配置 ===');
for (const [k, v] of Object.entries(DIFFICULTIES)) {
  console.log(`${v.label.padEnd(3)} 深度=${String(v.maxDepth).padStart(2)} 犯错率=${(v.blunder * 100).toFixed(0)}% 宽容=${v.tolerance}`);
}

console.log('\n=== 互相对弈（每组 6 盘）===');
const pairs = [
  ['normal', 'easy'],
  ['hard', 'normal'],
  ['hard', 'easy'],
];
for (const [a, b] of pairs) {
  const r = match(a, b, 6);
  const na = DIFFICULTIES[a].label, nb = DIFFICULTIES[b].label;
  console.log(`${na} vs ${nb}:  ${na}胜${r.aWins}  负${r.bWins}  和${r.draws}`);
}

// 单档连续对局，看走法多样性（避免每盘都一样）
console.log('\n=== 走法多样性（同一局面重复 10 次）===');
for (const d of ['easy', 'normal', 'hard']) {
  const b = new Board();
  const set = new Set();
  for (let i = 0; i < 10; i++) {
    const r = chooseMove(b, d);
    if (r && r.move) set.add(JSON.stringify(r.move.from) + '->' + JSON.stringify(r.move.to));
  }
  console.log(`${DIFFICULTIES[d].label}: 10 次出 ${set.size} 种不同走法`);
}
