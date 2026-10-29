// 生成一份真实对局的棋谱文件（用于测试导入 + 用户样本）
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

const board = new Board();
const startFen = board.toFen();
const moves = [];
let ply = 0;
let result = '未分胜负';

while (ply < 200) {
  const st = board.gameStatus();
  if (st.over) {
    result = st.winner === RED ? '红胜' : st.winner === BLACK ? '黑胜' : '和棋';
    break;
  }
  const isRed = board.side === RED;
  const res = isRed
    ? (clearTT(), searchBestMove(board, { maxDepth: 5, timeLimitMs: 1500 }))
    : chooseMove(board, 'hard');
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

const game = {
  id: 'sample-' + Date.now().toString(36),
  title: '示例：红方(深5) vs 困难',
  date: new Date().toISOString().slice(0, 16).replace('T', ' '),
  mode: 'pve',
  result,
  startFen,
  moves,
};

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/示例棋谱.json', JSON.stringify(game, null, 2));
console.log(`已生成 dist/示例棋谱.json：${moves.length} 步，结果 ${result}`);
console.log('前 6 步:', moves.slice(0, 6).map((m) => m.text).join(' '));
