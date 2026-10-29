// 难度合理性评测
// 用强度更高的搜索当裁判，看各档选的棋离"最佳"有多远（平均损失分）。
// 关键：用平均值而非最大值，且样本要够大，否则随机波动会掩盖真实差距。
import { Board, RED, BLACK } from '../app/engine.js';
import { chooseMove, searchBestMove, evaluate, DIFFICULTIES, clearTT } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// 参考局面：中局为主，因为中局的着法质量最能体现水平
function makePositions() {
  const out = [];
  const seqs = [
    // 开局几步后的常规中局
    [
      { from: [1, 7], to: [2, 7] }, { from: [1, 0], to: [2, 2] },
      { from: [7, 7], to: [6, 7] }, { from: [7, 0], to: [6, 2] },
      { from: [1, 9], to: [2, 7] }, { from: [1, 2], to: [2, 2] },
    ],
    // 另一路走法
    [
      { from: [7, 7], to: [7, 4] }, { from: [7, 0], to: [7, 3] },
      { from: [1, 7], to: [4, 7] }, { from: [1, 0], to: [4, 0] },
      { from: [0, 6], to: [0, 5] }, { from: [0, 3], to: [0, 4] },
    ],
  ];
  for (const seq of seqs) {
    const b = new Board();
    for (const m of seq) {
      const legal = b.legalMoves(b.side);
      const f = legal.find(x =>
        x.from[0] === m.from[0] && x.from[1] === m.from[1] &&
        x.to[0] === m.to[0] && x.to[1] === m.to[1]);
      if (f) b.makeMove(f);
    }
    out.push(b);
  }
  return out;
}

const positions = makePositions();
const CANON = ['easy', 'normal', 'hard', 'master'];
const SAMPLES = 8; // 每档每局面取样次数

/** 该局面的最佳着法分数（裁判） */
function bestScore(board) {
  clearTT();
  const r = searchBestMove(board, { maxDepth: 4, timeLimitMs: 900 });
  return r ? r.score : 0;
}

/** 评估某个着法的得分（从走子方视角） */
function scoreOfMove(board, move) {
  const b = board.clone();
  b.makeMove(move);
  clearTT();
  const r = searchBestMove(b, { maxDepth: 4, timeLimitMs: 900 });
  return r ? -r.score : -evaluate(b, b.side);
}

console.log('=== 着法质量：平均损失分（0 = 完美，越大越差）===');
const avgLoss = {};
for (const diff of CANON) {
  let totalLoss = 0, count = 0;
  const perPos = [];
  for (const pos of positions) {
    const best = bestScore(pos);
    let posLoss = 0, n = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const r = chooseMove(pos, diff);
      if (!r || !r.move) continue;
      const s = scoreOfMove(pos, r.move);
      posLoss += Math.max(0, best - s);
      n++;
    }
    if (n > 0) { perPos.push(posLoss / n); totalLoss += posLoss; count += n; }
  }
  avgLoss[diff] = totalLoss / count;
  console.log(`${DIFFICULTIES[diff].label.padEnd(3)} 平均损失: ${avgLoss[diff].toFixed(1)} 分  (各局面: ${perPos.map(x => x.toFixed(0)).join(', ')})`);
}

console.log('\n=== 难度曲线必须单调 ===');
ok(avgLoss.easy > avgLoss.normal, `入门(${avgLoss.easy.toFixed(0)}) 明显弱于 普通(${avgLoss.normal.toFixed(0)})`);
ok(avgLoss.normal > avgLoss.hard, `普通(${avgLoss.normal.toFixed(0)}) 明显弱于 困难(${avgLoss.hard.toFixed(0)})`);
ok(avgLoss.hard >= avgLoss.master - 30, `困难(${avgLoss.hard.toFixed(0)}) 不弱于 大师(${avgLoss.master.toFixed(0)})`);

console.log('\n=== 差距要足够明显（至少半个兵的分值 50）===');
ok(avgLoss.easy - avgLoss.normal >= 50, `入门 vs 普通 相差 ${(avgLoss.easy - avgLoss.normal).toFixed(0)} 分`);
ok(avgLoss.normal - avgLoss.hard >= 30, `普通 vs 困难 相差 ${(avgLoss.normal - avgLoss.hard).toFixed(0)} 分`);

console.log('\n=== 走法多样性（同一开局 12 次）===');
for (const diff of CANON) {
  const b = new Board();
  const set = new Set();
  for (let i = 0; i < 12; i++) {
    const r = chooseMove(b, diff);
    if (r && r.move) set.add(JSON.stringify(r.move.from) + '->' + JSON.stringify(r.move.to));
  }
  console.log(`  ${DIFFICULTIES[diff].label}: ${set.size} 种 / 12 次`);
  if (diff === 'easy' || diff === 'normal') {
    ok(set.size >= 4, `${DIFFICULTIES[diff].label} 走法有足够变化（${set.size} 种）`);
  }
}

console.log(`\n难度评测：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
