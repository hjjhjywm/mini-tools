// 我方（红，深度6）挑战大师级，重复对局直到取胜或和棋，导出棋谱
import fs from 'node:fs';
import { Board, RED, BLACK, PIECE_CHARS, pieceSide } from '../app/engine.js';
import { chooseMove, searchBestMove, clearTT } from '../app/ai.js';

const COL = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function moveToChinese(board, m) {
  const p = board.pieceAt(m.from[0], m.from[1]);
  if (!p) return '?';
  const isRed = pieceSide(p) === RED;
  const ch = PIECE_CHARS[p];
  const fileOf = (x) => (isRed ? 9 - x : x + 1);
  const ff = COL[fileOf(m.from[0])];
  const tf = COL[fileOf(m.to[0])];
  if (m.to[1] === m.from[1]) return ch + ff + '平' + tf;
  const dir = isRed ? (m.to[1] < m.from[1] ? '进' : '退') : (m.to[1] > m.from[1] ? '进' : '退');
  const same = m.from[0] === m.to[0];
  return same ? ch + ff + dir + COL[Math.abs(m.to[1] - m.from[1])] : ch + ff + dir + tf;
}

/** 走一局，我方深度由 myDepth 决定，对手固定大师 */
function playOne(myDepth, maxPlies = 240) {
  const board = new Board();
  const startFen = board.toFen();
  const moves = [];
  let ply = 0;
  let result = '未分胜负';

  while (ply < maxPlies) {
    const st = board.gameStatus();
    if (st.over) {
      if (st.winner === RED) result = '红胜';
      else if (st.winner === BLACK) result = '黑胜';
      else result = '和棋';
      break;
    }
    const isRed = board.side === RED;
    const res = isRed
      ? (clearTT(), searchBestMove(board, { maxDepth: myDepth, timeLimitMs: 4000 }))
      : chooseMove(board, 'master');
    if (!res || !res.move) break;

    const text = moveToChinese(board, res.move);
    const cap = board.pieceAt(res.move.to[0], res.move.to[1]);
    moves.push({
      n: Math.floor(ply / 2) + 1,
      side: isRed ? 'r' : 'b',
      text,
      from: res.move.from.slice(),
      to: res.move.to.slice(),
      cap: cap ? PIECE_CHARS[cap] : null,
    });
    board.makeMove(res.move);
    ply++;
  }
  return { startFen, moves, result, plies: ply };
}

// 多局尝试：换个开局种子增加多样性
const attempts = [];
const configs = [
  { depth: 6, label: '深6' },
  { depth: 7, label: '深7' },
  { depth: 6, label: '深6' },
  { depth: 8, label: '深8' },
];

let best = null;
for (let i = 0; i < configs.length; i++) {
  const cfg = configs[i];
  const t0 = Date.now();
  const g = playOne(cfg.depth);
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`第 ${i + 1} 局（${cfg.label}）：${g.result}，${g.moves.length} 步，用时 ${sec}s`);
  attempts.push(g);

  if (g.result === '红胜' || g.result === '和棋') {
    best = { ...g, label: cfg.label };
    console.log(`  → 达到目标，采用这一局`);
    break;
  }
  if (!best) best = g;
}

const out = {
  id: 'vs-master-' + Date.now().toString(36),
  title: `我方(${best.label || '深6'}) vs 大师 — ${best.result}`,
  date: new Date().toISOString().slice(0, 16).replace('T', ' '),
  mode: 'pve',
  result: best.result,
  startFen: best.startFen,
  moves: best.moves,
};
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/我的对局-大师.json', JSON.stringify(out, null, 2));

console.log('='.repeat(50));
console.log(`已生成 dist/我的对局-大师.json`);
console.log(`结果：${out.result}　步数：${out.moves.length}`);
if (best.moves.length) {
  console.log('前 8 步:', best.moves.slice(0, 8).map((m) => m.text).join(' '));
  console.log('后 8 步:', best.moves.slice(-8).map((m) => m.text).join(' '));
}
