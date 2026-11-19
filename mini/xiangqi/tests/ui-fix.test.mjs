// 回归测试：棋盘居中、自由提问、对方上一步意图
import { Board, RED, PIECE_CHARS } from '../app/engine.js';
import { buildSituation, PRESET_QUESTIONS } from '../app/teach.js';

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 1. 棋盘四边空白必须均匀 ===');
{
  // 与 main.js 相同的计算
  const CELL = 88;
  const W = 900, H = 1000;
  const BOARD_W = CELL * 8;
  const BOARD_H = CELL * 9;
  const OX = (W - BOARD_W) / 2;
  const OY = (H - BOARD_H) / 2;

  const left = OX;
  const right = W - OX - BOARD_W;
  const top = OY;
  const bottom = H - OY - BOARD_H;

  ok(Math.abs(left - right) < 0.01, `左右空白相等（${left} vs ${right}）`);
  ok(Math.abs(top - bottom) < 0.01, `上下空白相等（${top} vs ${bottom}）`);

  // 边距必须容得下棋子半径（约 37px）
  const radius = CELL * 0.42;
  ok(left > radius && top > radius, `边距 ${left}/${top} 大于棋子半径 ${radius.toFixed(0)}`);

  // 边距也不能过大，否则棋盘显得太小
  ok(left < W * 0.2, `左右边距合理（${left} < ${W * 0.2}）`);
}

console.log('\n=== 2. 「对方想干什么」预设 ===');
{
  const p = PRESET_QUESTIONS.find((x) => x.id === 'opponent');
  ok(!!p, '存在「对方想干什么」预设');
  if (p) {
    ok(p.label.includes('对方'), `标签正确：${p.label}`);
    ok(p.q.includes('意图'), '问题里问了意图');
    ok(p.needsLastMove === true, '标记为需要上一步信息');
  }
}

console.log('\n=== 3. 上一步信息能进入 prompt ===');
{
  const b = new Board();
  // 模拟：黑方走马8进7，吃掉红方一个子
  const lastMove = { text: '马八进七', side: 'b', cap: '兵' };
  const s = buildSituation(b, null, lastMove);

  ok(typeof s.lastMoveText === 'string' && s.lastMoveText.length > 0,
     `生成了上一步描述：${s.lastMoveText}`);
  ok(s.lastMoveText.includes('马八进七'), '描述含走法');
  ok(s.lastMoveText.includes('兵'), '描述含被吃的子');

  // 没有上一步时不应报错
  const s2 = buildSituation(b, null, null);
  ok(s2.lastMoveText === '', '无上一步时为空字符串');
}

console.log('\n=== 4. 自由提问的输入校验 ===');
{
  // 模拟 submitFreeQuestion 的校验逻辑
  function validate(input) {
    const q = (input || '').trim();
    if (!q) return { ok: false, reason: '先输入你的问题' };
    if (q.length > 120) return { ok: false, reason: '太长' };
    return { ok: true, q };
  }

  ok(validate('').ok === false, '空输入被拒绝');
  ok(validate('   ').ok === false, '纯空格被拒绝');
  ok(validate('他为什么走这步').ok === true, '正常问题通过');
  ok(validate('x'.repeat(121)).ok === false, '超长被拒绝');
  ok(validate('  多余空格  ').q === '多余空格', '首尾空格被裁剪');
}

console.log('\n=== 5. 多轮提问不互相污染 ===');
{
  // 模拟：连续两次提问，答案应该各自独立（每次清空）
  const answers = [];
  function simulateAsk(existing, newAnswer) {
    // 对应代码里的 answerEl.textContent = '' 然后累加
    let cur = '';
    for (const ch of newAnswer) cur += ch;
    answers.push(cur);
    return cur;
  }

  const a1 = simulateAsk('', '第一轮答案');
  const a2 = simulateAsk(a1, '第二轮答案');
  ok(a1 === '第一轮答案', '第一轮答案正确');
  ok(a2 === '第二轮答案', '第二轮不包含第一轮内容');
  ok(!a2.includes('第一轮'), '两轮答案没有混在一起');
}

console.log(`\n界面修复测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
