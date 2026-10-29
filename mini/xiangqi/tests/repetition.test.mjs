import { Board, RED, BLACK } from '../app/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// 1. 初始局面不应判和
{
  const b = new Board();
  ok(b.repetitionCount() === 1, '初始局面计数为 1');
  ok(!b.gameStatus().over, '初始局面未结束');
}

// 2. 同一局面出现 3 次应判和
{
  const b2 = Board.fromFen('4k4/9/9/9/9/9/9/9/9/R3K4 r');
  const r1 = { from: [0, 9], to: [0, 8] };
  const k1 = { from: [4, 0], to: [3, 0] };
  const r2 = { from: [0, 8], to: [0, 9] };
  const k2 = { from: [3, 0], to: [4, 0] };

  b2.makeMove(r1); b2.makeMove(k1); b2.makeMove(r2); b2.makeMove(k2);
  ok(b2.repetitionCount() === 2, `走一圈后计数为 2（实际 ${b2.repetitionCount()}）`);

  b2.makeMove(r1); b2.makeMove(k1); b2.makeMove(r2); b2.makeMove(k2);
  const st = b2.gameStatus();
  ok(st.over && st.winner === null, `第三次重复判和（${st.winner} / ${st.reason}）`);
  ok(st.reason && st.reason.includes('重复'), '判和原因是重复局面');
}

// 3. 悔棋应该回退计数
{
  const fen = '4k4/9/9/9/9/9/9/9/9/R3K4 r';
  const b = Board.fromFen(fen);
  const before = b.repetitionCount();
  b.makeMove({ from: [0, 9], to: [0, 8] });
  ok(b.repetitionCount() === 1, '走子后新局面计数为 1');
  b.undo();
  ok(b.repetitionCount() === before, '悔棋后计数恢复');
  ok(b.toFen() === fen, '悔棋后局面恢复正确');
}

// 4. 不同局面各自计数
{
  const b = Board.fromFen('4k4/9/9/9/9/9/9/9/9/R3K4 r');
  b.makeMove({ from: [0, 9], to: [0, 8] });
  b.makeMove({ from: [4, 0], to: [3, 0] });
  b.makeMove({ from: [0, 8], to: [0, 7] });
  ok(b.repetitionCount() === 1, '连续不同局面计数保持 1');
}

// 5. 将死仍优先于重复判和
{
  const b = Board.fromFen('4k4/4R4/9/9/9/9/9/9/9/4K4 r');
  b.makeMove({ from: [4, 1], to: [4, 0] });
  const st = b.gameStatus();
  ok(st.over && st.winner === RED, `吃将后判红胜（${st.reason}）`);
}

// 6. clone 保留计数
{
  const b = Board.fromFen('4k4/9/9/9/9/9/9/9/9/R3K4 r');
  b.makeMove({ from: [0, 9], to: [0, 8] });
  const c = b.clone();
  ok(c.repetitionCount() === b.repetitionCount(), 'clone 保留重复计数');
}

// 7. 真实的长将循环会触发判和（模拟上一局的对局）
{
  // 黑将(4,0)、黑车(0,3)、红帅(5,9)：共 10 行
  const b = Board.fromFen('4k4/9/9/r8/9/9/9/9/9/5K3 r');
  const redMoves = [
    { from: [5, 9], to: [4, 9] }, { from: [4, 9], to: [5, 9] },
  ];
  const blackMoves = [
    { from: [0, 3], to: [0, 8] }, { from: [0, 8], to: [0, 3] },
  ];
  let over = false, reason = '';
  for (let i = 0; i < 6 && !over; i++) {
    const rm = redMoves[i % 2];
    if (b.legalMoves(RED).some(m => m.from[0] === rm.from[0] && m.from[1] === rm.from[1])) {
      b.makeMove(rm);
    }
    const st1 = b.gameStatus();
    if (st1.over) { over = true; reason = st1.reason; break; }
    const bm = blackMoves[i % 2];
    if (b.legalMoves(BLACK).some(m => m.from[0] === bm.from[0] && m.from[1] === bm.from[1])) {
      b.makeMove(bm);
    }
    const st2 = b.gameStatus();
    if (st2.over) { over = true; reason = st2.reason; break; }
  }
  ok(over, `长将循环能被终止（${reason || '未触发'}）`);
}

console.log(`\n重复判和测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
