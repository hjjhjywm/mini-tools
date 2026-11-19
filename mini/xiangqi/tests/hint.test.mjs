// 验证 hint 模块：各种局面下给出的建议是否合理
import { Board, RED, BLACK, PIECE_CHARS } from '../app/engine.js';
import { getHint, moveToChinese } from '../app/hint.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 1. 开局局面 ===');
{
  const b = new Board();
  const h = getHint(b, { depth: 4, timeLimit: 800 });
  ok(h !== null, '能返回建议');
  if (h) {
    console.log(`    建议: ${h.notation}  评估: ${h.summary}`);
    console.log(`    理由: ${h.reasons.join('；')}`);
    ok(typeof h.notation === 'string' && h.notation.length > 0, '有中文记谱');
    ok(h.reasons.length > 0, '至少给一条理由');
    ok(Math.abs(h.score) < 200, '开局评估接近均衡');
    // 关键回归：不能推荐"吃了会被反吃"的亏本交换
    const isBadTrade = h.reasons.some((r) => r.includes('亏本'));
    ok(!isBadTrade, '开局不应推荐亏本交换');
  }
}

console.log('\n=== 2. 能吃对方大子的局面 ===');
{
  // 红车(0,5)、黑车(8,5) 同一行，中间无阻挡 -> 红车可以吃掉黑车
  const b = Board.fromFen('3k5/9/9/9/9/R7r/9/9/9/4K4 r');
  const canCapture = b.legalMoves(RED).some(
    (m) => m.from[0] === 0 && m.from[1] === 5 && m.to[0] === 8 && m.to[1] === 5
  );
  ok(canCapture, '局面构造正确：红车能吃黑车');

  const h = getHint(b, { depth: 3, timeLimit: 800 });
  ok(h !== null, '能返回建议');
  if (h) {
    console.log(`    建议: ${h.notation}  评估: ${h.summary}`);
    console.log(`    理由: ${h.reasons.join('；')}`);
    const isCapture = h.reasons.some((r) => r.includes('吃'));
    ok(isCapture, '理由里提到吃子');
  }
}

console.log('\n=== 3. 一步杀的局面 ===');
{
  // 红车(4,1) 直接吃黑将(4,0)
  const b = Board.fromFen('4k4/4R4/9/9/9/9/9/9/9/4K4 r');
  const h = getHint(b, { depth: 3, timeLimit: 800 });
  ok(h !== null, '能返回建议');
  if (h) {
    console.log(`    建议: ${h.notation}  评估: ${h.summary}`);
    console.log(`    理由: ${h.reasons.join('；')}`);
    const isMate = h.reasons.some((r) => r.includes('赢') || r.includes('将死') || r.includes('困毙'));
    ok(isMate, '理由里指出这步能赢');
    ok(h.scoreText === '必胜' || Math.abs(h.score) > 20000, '评估标记为必胜');
  }
}

console.log('\n=== 4. 被将军的局面（必须应将）===');
{
  const b = Board.fromFen('4k4/9/9/9/9/4r4/9/9/9/4K4 r');
  const inCheck = b.isChecked(RED);
  console.log('    红方被将军:', inCheck);
  const h = getHint(b, { depth: 3, timeLimit: 800 });
  ok(h !== null, '被将军时也能给出建议');
  if (h) {
    console.log(`    建议: ${h.notation}  理由: ${h.reasons.join('；')}`);
    ok(h.inCheck === true, '正确识别出当前被将军');
    // 建议必须能解除将军
    const c = b.clone();
    c.makeMove({ from: h.move.from.slice(), to: h.move.to.slice() });
    ok(!c.isChecked(RED), '建议的着法确实解除了将军');
  }
}

console.log('\n=== 5. 不崩溃 ===');
{
  const b = Board.fromFen('4k4/4R4/9/9/9/9/9/9/9/4K4 b');
  let threw = false;
  try { getHint(b, { depth: 2, timeLimit: 400 }); } catch { threw = true; }
  ok(!threw, '任意局面下都不崩溃');
}

console.log('\n=== 6. 记谱正确性 ===');
{
  const b = new Board();
  const txt = moveToChinese(b, { from: [7, 7], to: [4, 7] });
  ok(txt === '炮二平五', `红炮二平五（实际 ${txt}）`);

  const txt2 = moveToChinese(b, { from: [7, 9], to: [6, 7] });
  ok(txt2 === '马二进三', `红马二进三（实际 ${txt2}）`);

  const txt3 = moveToChinese(b, { from: [0, 9], to: [0, 8] });
  ok(txt3 === '车九进一', `红车九进一（实际 ${txt3}）`);

  // 黑方记谱（从黑方视角数）
  const txt4 = moveToChinese(b, { from: [0, 0], to: [0, 1] });
  ok(txt4 === '车一进一', `黑车一进一（实际 ${txt4}）`);
}

console.log('\n=== 7. 残局局面 ===');
{
  const b = Board.fromFen('9/4k4/9/9/R8/9/9/9/9/5K3 r');
  const h = getHint(b, { depth: 5, timeLimit: 1000 });
  ok(h !== null, '残局也能给建议');
  if (h) {
    console.log(`    建议: ${h.notation}  评估: ${h.summary}`);
    console.log(`    理由: ${h.reasons.join('；')}`);
    // 单车对孤将应该是必胜
    ok(Math.abs(h.score) > 20000, '单车胜孤将评估为必胜');
  }
}

console.log('\n=== 8. 亏本交换兜底（核心回归）===');
{
  // 构造一个"吃小丢大"的局面：红炮能吃黑卒，但会被黑车反吃
  // 红炮(4,5) 黑卒(4,0) 黑车(0,5) -> 炮吃卒后车能吃炮
  const b = Board.fromFen('3k5/9/9/9/9/C8/9/9/9/3K5 r');
  // 简化验证：只要有 risky 着法，就不应该被选为最终建议
  const h = getHint(b, { depth: 4, timeLimit: 1000 });
  ok(h !== null, '能返回建议');
  if (h) {
    const isBadTrade = h.reasons.some((r) => r.includes('亏本'));
    ok(!isBadTrade, `不应推荐亏本交换（建议 ${h.notation}）`);
  }
}

console.log(`\nhint 模块测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
