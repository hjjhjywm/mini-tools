import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('index.html', here), 'utf8');

const START = '// ==SOLVER-START==';
const END = '// ==SOLVER-END==';
const i = html.indexOf(START);
const j = html.indexOf(END);
if (i === -1 || j === -1 || j < i) {
  console.error('FAIL: 找不到 SOLVER 标记');
  process.exit(1);
}
const code = html.slice(i + START.length, j);

const factory = new Function(
  code +
    '\nreturn { solve, generatePuzzle, validateExpression, rat, rAdd, rSub, rMul, rDiv, rEq24, rText, insertText, deleteBack };'
);
const S = factory();
console.log('抽取解题逻辑:', code.length, '字符\n');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  FAIL -', name, detail ?? '');
  }
}

/* ---------- 0. 整份脚本语法检查（只解析，不执行） ---------- */
console.log('== 0. 语法检查 ==');
let syntaxOk = false;
let syntaxErr = '';
try {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('找不到 <script> 块');
  new Function(m[1]);
  syntaxOk = true;
} catch (e) {
  syntaxErr = e.message;
}
check('整份内联脚本可被解析', syntaxOk, syntaxErr);

/* ---------- 独立的对照求解器（模式枚举法） ---------- */
const OPS = ['+', '-', '*', '/'];
function fdiv(a, b) {
  if (b[0] === 0) return null;
  return [a[0] * b[1], a[1] * b[0]];
}
function apply(op, a, b) {
  switch (op) {
    case '+': return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
    case '-': return [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
    case '*': return [a[0] * b[0], a[1] * b[1]];
    case '/': return fdiv(a, b);
  }
  return null;
}
function is24(v) {
  return v && v[1] !== 0 && v[0] === 24 * v[1];
}
function perms(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let k = 0; k < arr.length; k++) {
    const rest = arr.slice(0, k).concat(arr.slice(k + 1));
    for (const p of perms(rest)) out.push([arr[k]].concat(p));
  }
  return out;
}
/* 安全求值：任一侧无定义则整体无定义（阻止除零继续扩散） */
function ap(op, a, b) {
  if (!a || !b) return null;
  return apply(op, a, b);
}
/* 五种括号结构 */
const PATTERNS = [
  (a, b, c, d, o) => ap(o[2], ap(o[1], ap(o[0], a, b), c), d),
  (a, b, c, d, o) => ap(o[2], ap(o[0], a, ap(o[1], b, c)), d),
  (a, b, c, d, o) => ap(o[0], a, ap(o[2], ap(o[1], b, c), d)),
  (a, b, c, d, o) => ap(o[0], a, ap(o[1], b, ap(o[2], c, d))),
  (a, b, c, d, o) => ap(o[1], ap(o[0], a, b), ap(o[2], c, d)),
];
function solvableByPattern(nums) {
  for (const p of perms(nums)) {
    const f = p.map((n) => [n, 1]);
    for (const o0 of OPS) for (const o1 of OPS) for (const o2 of OPS) {
      const ops = [o0, o1, o2];
      for (const pat of PATTERNS) {
        const v = pat(f[0], f[1], f[2], f[3], ops);
        if (is24(v)) return true;
      }
    }
  }
  return false;
}

/* ---------- 1. 基础分数运算 ---------- */
console.log('== 1. 分数运算 ==');
check('1/3 + 1/6 = 1/2', S.rText(S.rAdd(S.rat(1, 3), S.rat(1, 6))) === '1/2', S.rText(S.rAdd(S.rat(1, 3), S.rat(1, 6))));
check('1/3 ÷ 1/3 = 1', S.rText(S.rDiv(S.rat(1, 3), S.rat(1, 3))) === '1');
check('除以 0 返回 null', S.rDiv(S.rat(1, 2), S.rat(0, 1)) === null);
check('负数分母归一化', S.rText(S.rat(1, -2)) === '-1/2', S.rText(S.rat(1, -2)));
check('24 判定', S.rEq24(S.rat(24, 1)) === true && S.rEq24(S.rat(48, 2)) === true && S.rEq24(S.rat(25, 1)) === false);

/* ---------- 2. 经典题必解 ---------- */
console.log('\n== 2. 经典题 ==');
const known = [
  [[3, 3, 8, 8], true],
  [[4, 4, 10, 10], true],
  [[1, 5, 5, 5], true],
  [[1, 1, 1, 1], false],
  [[7, 7, 7, 7], false],
  [[1, 2, 3, 4], true],
  [[5, 5, 5, 1], true],
];
for (const [nums, expected] of known) {
  const ans = S.solve(nums);
  check(`${nums.join(',')} 可解性 = ${expected}`, !!ans === expected, '得到 ' + ans);
  if (expected && ans) {
    const v = S.validateExpression(ans, nums);
    check(`  解式自洽: ${ans}`, v.ok === true, v.message);
  }
}

/* ---------- 3. 与独立求解器交叉验证（1..6 全部 1296 组） ---------- */
console.log('\n== 3. 交叉验证（1..6 全组合） ==');
let cross = 0;
let mism = 0;
for (let a = 1; a <= 6; a++)
  for (let b = 1; b <= 6; b++)
    for (let c = 1; c <= 6; c++)
      for (let d = 1; d <= 6; d++) {
        const nums = [a, b, c, d];
        const mine = !!S.solve(nums);
        const ref = solvableByPattern(nums);
        cross++;
        if (mine !== ref) {
          mism++;
          if (mism <= 5) console.log('  不一致:', nums.join(','), 'mine=', mine, 'ref=', ref);
        }
      }
check(`1296 组全部一致（实际比对 ${cross} 组）`, mism === 0, `不一致 ${mism} 组`);

/* ---------- 4. 生成的解一定能通过校验 ---------- */
console.log('\n== 4. 生成的解可通过校验 ==');
let badExpr = 0;
const samples = [];
for (let t = 0; t < 300; t++) {
  const nums = S.generatePuzzle(13, 1);
  const ans = S.solve(nums);
  if (!ans) {
    badExpr++;
    continue;
  }
  const v = S.validateExpression(ans, nums);
  if (!v.ok) {
    badExpr++;
    if (samples.length < 3) samples.push([nums, ans, v.message]);
  }
}
check('300 局生成的解全部自洽', badExpr === 0, JSON.stringify(samples));

/* ---------- 5. 校验器拒绝错误输入 ---------- */
console.log('\n== 5. 校验器负例 ==');
const N = [3, 3, 8, 8];
const neg = [
  ['8/(3-8/3)', true, '标准解'],
  ['8 ÷ ( 3 − 8 ÷ 3 )', true, '全角与空格'],
  ['(3+3)*4', false, '用了不存在的数字'],
  ['8*3', false, '只用了两个数'],
  ['3+3+8+8', false, '结果是 22 不是 24'],
  ['8/(3-3)', false, '除以 0'],
  ['8/(3-8/3', false, '括号不匹配'],
  ['8*(3', false, '算式不完整'],
  ['1+2+3+4', false, '数字完全不对'],
  ['', false, '空输入'],
  ['8/(3-8/3))+', false, '多余括号'],
  ['abc', false, '非法字符'],
  ['08/(3-8/3)', true, '前导零按同值处理（08 视为 8，不构成作弊）'],
];
for (const [expr, expectOk, label] of neg) {
  const r = S.validateExpression(expr, N);
  check(`${label}: 「${expr}」→ ${r.ok ? '通过' : '拒绝'}`, r.ok === expectOk, r.message);
}

/* ---------- 6. 生成的题目必有解 ---------- */
console.log('\n== 6. 生成器必出有解题 ==');
let unsolvable = 0;
for (let t = 0; t < 500; t++) {
  const nums = S.generatePuzzle(9, 1);
  if (!S.solve(nums)) unsolvable++;
  if (nums.some((n) => n < 1 || n > 9)) unsolvable++;
}
check('500 局简单难度全部合法且有解', unsolvable === 0, `问题 ${unsolvable} 局`);

/* ---------- 7. 健壮性 ---------- */
console.log('\n== 7. 健壮性 ==');

const longInput = '1+'.repeat(80) + '1';
const rLong = S.validateExpression(longInput, N);
check('超长算式被拒绝', rLong.ok === false && rLong.message.indexOf('太长') !== -1, rLong.message);

const deep = '('.repeat(30) + '8' + ')'.repeat(30);
const rDeep = S.validateExpression(deep, N);
check('30 层括号被拒绝', rDeep.ok === false, rDeep.message);

const okDepth = '('.repeat(10) + '8' + ')'.repeat(10) + '/(3-8/3)';
const rOkDepth = S.validateExpression(okDepth, N);
check('10 层括号仍然可用', rOkDepth.ok === true, rOkDepth.message);

check('nums 为 null 时安全返回', S.validateExpression('1+2', null).ok === false);
check('nums 数量不对时安全返回', S.validateExpression('1+2', [1, 2]).ok === false);
check('nums 非数组时安全返回', S.validateExpression('1+2', 'abcd').ok === false);

const weird = S.generatePuzzle(0, 0);
check(
  'generatePuzzle(0,0) 回退到 1..13',
  weird.length === 4 && weird.every((n) => n >= 1 && n <= 13),
  JSON.stringify(weird)
);

const inverted = S.generatePuzzle(-5, 100);
check(
  'generatePuzzle(-5,100) 倒置参数不崩溃且可解',
  Array.isArray(inverted) && inverted.length === 4 && !!S.solve(inverted),
  JSON.stringify(inverted)
);

const nasty = ['(((((', '))))', '+-+-', '1/0', '9'.repeat(200), '', '   ', '((8))', '8//3', '8**3'];
let threw = 0;
for (const x of nasty) {
  try {
    S.validateExpression(x, N);
  } catch (e) {
    threw++;
  }
}
check('10 组畸形输入均不抛异常', threw === 0, '抛出 ' + threw + ' 次');

/* ---------- 8. 屏幕键盘 ---------- */
console.log('\n== 8. 屏幕键盘 ==');

const openDivs = (html.match(/<div\b/g) || []).length;
const closeDivs = (html.match(/<\/div>/g) || []).length;
check('div 开闭标签数量一致', openDivs === closeDivs, openDivs + ' vs ' + closeDivs);

const openAside = (html.match(/<aside\b/g) || []).length;
const closeAside = (html.match(/<\/aside>/g) || []).length;
check('aside 标签配对', openAside === 1 && closeAside === 1, openAside + ' vs ' + closeAside);

const insKeys = Array.from(html.matchAll(/data-ins="([^"]*)"/g)).map((m) => m[1]);
check(
  '输入键 16 个（10 数字 + 4 运算符 + 2 括号）',
  insKeys.length === 16,
  '实际 ' + insKeys.length
);
const totalKeys = (html.match(/<button type="button" class="key/g) || []).length;
check('键盘总按键 19 个', totalKeys === 19, '实际 ' + totalKeys);

const actKeys = Array.from(html.matchAll(/data-act="([^"]*)"/g)).map((m) => m[1]);
check(
  '功能键为 back/clear/submit',
  actKeys.length === 3 && ['back', 'clear', 'submit'].every((k) => actKeys.indexOf(k) !== -1),
  actKeys.join(',')
);

const rejected = [];
for (const k of insKeys) {
  const r = S.validateExpression('8' + k + '3', N);
  if (r.message && r.message.indexOf('无法识别') !== -1) rejected.push(k);
}
check('每个键盘输入键都被词法器接受', rejected.length === 0, '被拒: ' + rejected.join(' '));

const digits = insKeys.filter((k) => /^[0-9]$/.test(k)).sort().join('');
check('数字键 0-9 齐全', digits === '0123456789', digits);

/* ---------- 9. 光标插入 ---------- */
console.log('\n== 9. 光标插入 ==');

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

check('开头插入 (', same(S.insertText('3-1', 0, '('), { value: '(3-1', caret: 1 }), JSON.stringify(S.insertText('3-1', 0, '(')));
check('结尾插入 )', same(S.insertText('3-1', 3, ')'), { value: '3-1)', caret: 4 }), JSON.stringify(S.insertText('3-1', 3, ')')));
check('中间插入 +', same(S.insertText('12', 1, '+'), { value: '1+2', caret: 2 }), JSON.stringify(S.insertText('12', 1, '+')));
check('空串插入', same(S.insertText('', 0, '7'), { value: '7', caret: 1 }));
check('位置越界视为末尾', same(S.insertText('12', 99, '3'), { value: '123', caret: 3 }));
check('负位置视为开头', same(S.insertText('12', -5, '0'), { value: '012', caret: 1 }));
check('NaN 位置视为末尾', same(S.insertText('12', NaN, '9'), { value: '129', caret: 3 }));

check('退格删中间字符', same(S.deleteBack('123', 2), { value: '13', caret: 1 }));
check('退格在开头不动', same(S.deleteBack('123', 0), { value: '123', caret: 0 }));
check('退格越界删末尾', same(S.deleteBack('123', 99), { value: '12', caret: 2 }));
check('空串退格安全', same(S.deleteBack('', 0), { value: '', caret: 0 }));

let step = S.insertText('3-1', 0, '(');
step = S.insertText(step.value, step.value.length, ')');
check('先点 ( 再点 ) 得到 (3-1)', step.value === '(3-1)' && step.caret === 5, JSON.stringify(step));

/* ---------- 汇总 ---------- */
console.log('\n====================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
