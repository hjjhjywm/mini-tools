import { Board, RED } from '../app/engine.js';
import { searchBestMove, chooseMove, clearTT, DIFFICULTIES } from '../app/ai.js';

const b = new Board();
// 开局后几步的典型局面
for (const m of [{from:[1,7],to:[2,7]}, {from:[1,0],to:[2,2]}, {from:[7,7],to:[6,7]}]) {
  b.makeMove(m);
}

console.log('当前局面 side:', b.side);
for (const [key, cfg] of Object.entries(DIFFICULTIES)) {
  clearTT();
  const t0 = Date.now();
  const r = searchBestMove(b, { maxDepth: cfg.maxDepth, timeLimitMs: cfg.timeLimitMs });
  const dt = Date.now() - t0;
  console.log(`${key.padEnd(7)} 深度=${r ? r.depth : 0} 节点=${r ? r.nodes : 0} 用时=${dt}ms 评估=${r ? r.score : '-'}`);
}
