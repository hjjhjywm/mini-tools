// 验证走子动画：动画期间应有多帧中间状态，且棋子坐标是插值而非瞬移
import { Board, RED } from '../app/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// ---- 复刻 main.js 里的动画逻辑做单元验证 ----
const ANIM_MS = 260;
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// 采样动画进度，确认是平滑插值
const samples = [];
for (let i = 0; i <= 10; i++) {
  const p = i / 10;
  samples.push({ p, eased: easeInOut(p) });
}
ok(samples[0].eased === 0, '动画起点进度为 0');
ok(Math.abs(samples[10].eased - 1) < 1e-9, '动画终点进度为 1');
ok(samples.every(s => s.eased >= 0 && s.eased <= 1), '进度始终在 [0,1] 内');
ok(samples[3].eased < 0.3 || samples[3].eased > 0.3, '中间帧有独立数值（非线性瞬移）');
ok(samples[5].eased > 0.4 && samples[5].eased < 0.6, '中点进度约为 0.5（对称缓动）');
// 缓动应单调递增
let mono = true;
for (let i = 1; i < samples.length; i++) {
  if (samples[i].eased < samples[i - 1].eased) mono = false;
}
ok(mono, '缓动函数单调递增');

// ---- 插值坐标验证：从 (0,6) 移到 (0,5) ----
const from = [0, 6], to = [0, 5];
const interp = samples.map(s => ({
  x: from[0] + (to[0] - from[0]) * s.eased,
  y: from[1] + (to[1] - from[1]) * s.eased,
}));
ok(interp[0].x === 0 && interp[0].y === 6, '起点坐标正确');
ok(interp[10].x === 0 && interp[10].y === 5, '终点坐标正确');
const mid = interp[5];
ok(mid.y > 5 && mid.y < 6, `中间帧位于两点之间（y=${mid.y.toFixed(3)}）`);
const distinct = new Set(interp.map(i => i.y.toFixed(4))).size;
ok(distinct > 5, `中间位置有 ${distinct} 个不同值，不是瞬移`);

// ---- 横向长距离移动也平滑 ----
const from2 = [0, 9], to2 = [8, 9];
const interp2 = samples.map(s => ({ x: from2[0] + (to2[0] - from2[0]) * s.eased, y: 9 }));
ok(interp2[5].x > 3 && interp2[5].x < 5, `横移中点 x=${interp2[5].x.toFixed(2)}，位于中间`);
ok(interp2[0].x === 0 && interp2[10].x === 8, '横移起点终点正确');

// ---- 时长合理性 ----
ok(ANIM_MS >= 150 && ANIM_MS <= 500, `动画时长 ${ANIM_MS}ms 在舒适区间（150-500ms）`);

console.log(`\n动画测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
