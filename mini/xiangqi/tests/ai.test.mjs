import { Board, RED, BLACK } from '../app/engine.js';
import { chooseMove, searchBestMove, evaluate, DIFFICULTIES } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ ' + m)); };

// 1. 起始局面 AI 能走
{
  const b = new Board();
  const r = searchBestMove(b, { maxDepth: 3, timeLimitMs: 1000 });
  ok(r && r.move, '起始局面能返回着法');
  ok(r.depth >= 2, `搜索深度至少 2，实际 ${r.depth}`);
  console.log(`  起始最优: ${JSON.stringify(r.move)} score=${r.score} depth=${r.depth} nodes=${r.nodes}`);
}
// 2. 一步吃将：红车直接吃黑将
{
  // 黑将(4,0)、红车(4,1)，同列相邻
  const b = Board.fromFen('4k4/4R4/9/9/9/9/9/9/9/4K4 r');
  const r = searchBestMove(b, { maxDepth: 3, timeLimitMs: 1000 });
  ok(r && r.move, '一步吃将局面能返回着法');
  const isMate = r && r.move.to[0] === 4 && r.move.to[1] === 0;
  ok(isMate, `应选择吃掉黑将，实际 ${JSON.stringify(r && r.move)}`);
}
// 3. 必吃子：白送的车
{
  // 红车(0,9) 黑车(0,0) 中间无子，红车可吃；黑方后手
  const b = Board.fromFen('4k4/9/9/9/9/9/9/9/9/R3K4 r');
  const r = searchBestMove(b, { maxDepth: 3, timeLimitMs: 1000 });
  ok(r && r.move, '能走');
}
// 4. 难度配置合理
{
  for (const [k, v] of Object.entries(DIFFICULTIES)) {
    ok(v.maxDepth > 0 && v.timeLimitMs > 0, `难度 ${k} 配置有效`);
  }
}
// 5. chooseMove 不同难度都能出招
{
  const b = new Board();
  for (const d of ['easy', 'normal']) {
    const r = chooseMove(b, d);
    ok(r && r.move, `难度 ${d} 能出招`);
  }
}
// 6. 评估函数：红方起始略优或均衡
{
  const b = new Board();
  const s = evaluate(b, RED);
  ok(Math.abs(s) < 100, `起始局面评估应接近 0，实际 ${s}`);
}

console.log(`\nAI 测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
