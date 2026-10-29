// 回顾模块测试：存储、导入导出、逐手回放
import { Board, RED, BLACK } from '../app/engine.js';
import { Replayer, fromImport, toJson, addGame, loadAll, isSameGame } from '../app/replay.js';

// replay.js 用 localStorage 存数据，这里给个内存桩
const _store = new Map();
global.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// 造一份棋谱
const sampleGame = {
  id: 'test1',
  title: '测试对局',
  date: '2026-10-28 13:00',
  mode: 'pve',
  result: '红胜',
  startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r',
  moves: [
    { n: 1, side: 'r', text: '炮二平五', from: [7, 7], to: [4, 7], cap: null },
    { n: 1, side: 'b', text: '马8进7', from: [1, 0], to: [2, 2], cap: null },
    { n: 2, side: 'r', text: '马二进三', from: [7, 9], to: [6, 7], cap: null },
  ],
};

console.log('=== 回放器 ===');
{
  const rp = new Replayer(sampleGame);
  ok(rp.total === 3, `总步数为 3（实际 ${rp.total}）`);
  ok(rp.playable === true, '有坐标的棋谱可重放');
  ok(rp.current === 0, '初始在第 0 步');
  ok(rp.atStart === true, '初始在开头');

  // 执行到第 1 步
  rp.index = 1;
  ok(rp.currentText.includes('炮二平五'), `第 1 步文本正确：${rp.currentText}`);

  // 棋盘重放到第 1 步
  const b1 = rp.boardAt(1, Board);
  ok(b1.pieceAt(4, 7) === 'C', '炮已移动到中路');
  ok(b1.pieceAt(7, 7) === null, '原位置已空');

  // 重放到第 3 步
  const b3 = rp.boardAt(3, Board);
  ok(b3.pieceAt(6, 7) === 'N', '第 3 步后马已就位');

  // 回到 0
  const b0 = rp.boardAt(0, Board);
  ok(b0.toFen() === sampleGame.startFen, '第 0 步等于起始局面');
}

console.log('\n=== 无坐标棋谱 ===');
{
  const noCoord = { ...sampleGame, moves: [{ n: 1, side: 'r', text: '炮二平五', from: null, to: null }] };
  const rp = new Replayer(noCoord);
  ok(rp.playable === false, '缺少坐标时标记为不可重放');
}

console.log('\n=== 导入 ===');
{
  // JSON 导入
  const json = toJson(sampleGame);
  const r1 = fromImport(json);
  ok(r1.ok === true, 'JSON 导入成功');
  ok(r1.game.moves.length === 3, 'JSON 导入步数正确');

  // 文本导入
  const r2 = fromImport('炮二平五 马8进7 马二进三');
  ok(r2.ok === true, '文本导入成功');
  ok(r2.game.moves.length === 3, '文本导入解析出 3 步');
  ok(r2.game.moves[0].side === 'r' && r2.game.moves[1].side === 'b', '文本导入的红黑交替正确');

  // 空内容
  const r3 = fromImport('');
  ok(r3.ok === false, '空内容导入失败');

  // 坏 JSON
  const r4 = fromImport('{bad json}');
  ok(r4.ok === false, '坏 JSON 导入失败且有错误信息');
}

console.log('\n=== 越界保护 ===');
{
  const rp = new Replayer(sampleGame);
  const b = rp.boardAt(999, Board);
  ok(b !== null, '超出步数时不崩溃');
  ok(rp.boardAt(-5, Board) !== null, '负数步数时不崩溃');
}

console.log('\n=== 存储去重 ===');
{
  global.localStorage.setItem('xiangqi.replays.v1', '[]');

  const base = {
    title: 'A', mode: 'pve', result: '红胜',
    startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r',
    moves: [
      { n: 1, side: 'r', text: '炮二平五', from: [7, 7], to: [4, 7], cap: null },
      { n: 1, side: 'b', text: '马8进7', from: [1, 0], to: [2, 2], cap: null },
    ],
  };

  const r1 = addGame(base);
  ok(r1.duplicated === false, '首次保存：不是重复');
  ok(loadAll().length === 1, `首次保存后 1 条（实际 ${loadAll().length}）`);

  const r2 = addGame(base);
  ok(r2.duplicated === true, '同样内容再存：识别为重复');
  ok(loadAll().length === 1, `重复保存后仍 1 条（实际 ${loadAll().length}）`);
  ok(r2.record.id === r1.record.id, '返回的是已存在那条记录');

  // 多一步就算不同局
  const longer = {
    ...base,
    moves: [...base.moves, { n: 2, side: 'r', text: '马二进三', from: [7, 9], to: [6, 7], cap: null }],
  };
  const r3 = addGame(longer);
  ok(r3.duplicated === false, '多一步的对局不算重复');
  ok(loadAll().length === 2, `现在共 2 条（实际 ${loadAll().length}）`);

  // isSameGame 直接判定
  ok(isSameGame(base, base) === true, 'isSameGame 同局返回 true');
  ok(isSameGame(base, longer) === false, 'isSameGame 不同局返回 false');
  ok(isSameGame(null, base) === false, 'isSameGame 空值安全');
}

console.log(`\n回顾模块测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
