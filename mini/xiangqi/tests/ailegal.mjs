import { Board, RED } from '../app/engine.js';
import { chooseMove } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ ' + m)); };

// AI 在不同难度下返回的都是合法着法
for (const diff of ['easy', 'normal']) {
  const b = new Board();
  const res = chooseMove(b, diff);
  const legal = b.legalMoves(b.side);
  const valid = res && legal.some(m =>
    m.from[0] === res.move.from[0] && m.from[1] === res.move.from[1] &&
    m.to[0] === res.move.to[0] && m.to[1] === res.move.to[1]);
  ok(valid, `${diff} 难度返回合法着法: ${res ? JSON.stringify(res.move) : 'null'}`);
}

// 中局也能返回合法着法
{
  const b = new Board();
  for (const m of [{from:[1,7],to:[2,7]},{from:[1,0],to:[2,2]},{from:[7,7],to:[6,7]},{from:[7,0],to:[6,2]}]) {
    const legal = b.legalMoves(b.side);
    const found = legal.find(x => x.from[0]===m.from[0]&&x.from[1]===m.from[1]&&x.to[0]===m.to[0]&&x.to[1]===m.to[1]);
    if (found) b.makeMove(found);
  }
  const res = chooseMove(b, 'normal');
  const legal = b.legalMoves(b.side);
  const valid = res && legal.some(m =>
    m.from[0] === res.move.from[0] && m.from[1] === res.move.from[1] &&
    m.to[0] === res.move.to[0] && m.to[1] === res.move.to[1]);
  ok(valid, `中局返回合法着法: ${res ? JSON.stringify(res.move) : 'null'}`);
}

console.log(`\nAI 合法性测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
