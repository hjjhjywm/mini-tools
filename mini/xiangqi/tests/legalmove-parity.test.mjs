// 严格验证 genLegalMoves 快速通道：与"全部走法都检查"的暴力版本逐一对拍
import { Board, RED, BLACK } from '../app/engine.js';
import { genLegalMoves } from '../app/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

/**
 * 暴力参考实现：所有伪合法着法都做完整 inCheck 验证
 * （engine 的 legalMoves 就是这个语义，直接用它当基准）
 */
function referenceLegal(board, side) {
  return board.legalMoves(side);
}

function moveKey(m) {
  return `${m.from[0]},${m.from[1]}>${m.to[0]},${m.to[1]}`;
}

function compare(board, side, label) {
  const fast = genLegalMoves(board, side).map(moveKey).sort();
  const ref = referenceLegal(board, side).map(moveKey).sort();

  const missing = ref.filter((k) => !fast.includes(k));
  const extra = fast.filter((k) => !ref.includes(k));

  const same = missing.length === 0 && extra.length === 0;
  if (!same) {
    console.log(`  ✗ ${label}: 快速版 ${fast.length} 步 vs 参考 ${ref.length} 步`);
    if (missing.length) console.log(`     漏掉 ${missing.length} 步: ${missing.slice(0, 5).join(' ')}`);
    if (extra.length) console.log(`     多出 ${extra.length} 步: ${extra.slice(0, 5).join(' ')}`);
  }
  return same;
}

console.log('=== 1. 初始局面 ===');
{
  const b = new Board();
  ok(compare(b, RED, '开局红方'), '开局红方着法一致');
  ok(compare(b, BLACK, '开局黑方'), '开局黑方着法一致');
}

console.log('\n=== 2. 各种残局局面 ===');
{
  const fens = [
    ['单车胜孤将', '9/4k4/9/9/R8/9/9/9/9/5K3 r'],
    ['双车错', '4k4/9/9/9/R8/9/9/9/R8/4K4 r'],
    ['炮马胜', '4k4/9/9/9/4N4/9/9/9/9/3K1C3 r'],
    ['车兵胜车', '4k4/9/6r2/9/4P4/R8/9/9/9/4K4 r'],
    ['被将军', '4k4/9/9/9/9/4r4/9/9/9/4K4 r'],
    ['将帅照面', '4k4/9/9/9/9/9/9/9/9/4K4 r'],
    ['马兵仕胜车', '4k4/9/8r/9/4P4/9/2N6/9/9/3AK4 r'],
  ];
  for (const [name, fen] of fens) {
    const b = Board.fromFen(fen);
    ok(compare(b, RED, name), `${name}：红方着法一致`);
    ok(compare(b, BLACK, `${name}(黑)`), `${name}：黑方着法一致`);
  }
}

console.log('\n=== 3. 随机走子后的大量局面（对拍 200 局）===');
{
  let checked = 0;
  let mismatches = 0;
  for (let game = 0; game < 20; game++) {
    const b = new Board();
    for (let ply = 0; ply < 30; ply++) {
      const st = b.gameStatus();
      if (st.over) break;

      // 对拍
      const side = b.side;
      if (!compare(b, side, `对局${game}第${ply}步`)) {
        mismatches++;
        if (mismatches > 3) break;
      }
      checked++;

      // 随机走一步继续
      const legal = b.legalMoves(side);
      if (legal.length === 0) break;
      b.makeMove(legal[Math.floor(Math.random() * legal.length)]);
    }
    if (mismatches > 3) break;
  }
  ok(mismatches === 0, `随机局面 ${checked} 个全部一致（不一致 ${mismatches} 个）`);
}

console.log('\n=== 4. 将帅被威胁的边界情况 ===');
{
  // 红帅(4,9)，黑车在同列 (4,0)，红方中间有个子挡着
  const cases = [
    ['同列有遮挡', '4k4/4r4/9/9/9/9/9/9/9/4K4 r'],
    ['同列无遮挡(照面)', '4k4/9/9/9/9/9/9/9/9/4K4 r'],
    ['同行威胁', '9/9/9/9/9/9/9/9/9/r3K4 r'],
    ['炮隔子将军', '4k4/9/9/9/9/9/9/4C4/9/4K4 r'],
  ];
  for (const [name, fen] of cases) {
    const b = Board.fromFen(fen);
    ok(compare(b, RED, name), `${name}：着法一致`);
  }
}

console.log(`\ngenLegalMoves 对拍测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
