// 演示对局：我方（红方，用深度6搜索）vs 大师级 AI（黑方）
import { Board, RED, BLACK, PIECE_CHARS, pieceSide } from '../app/engine.js';
import { chooseMove, searchBestMove, clearTT, DIFFICULTIES } from '../app/ai.js';

const COL_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function moveToChinese(board, m) {
  const p = board.pieceAt(m.from[0], m.from[1]);
  if (!p) return '?';
  const isRed = pieceSide(p) === RED;
  const char = PIECE_CHARS[p];
  const fileOf = (x) => isRed ? 9 - x : x + 1;
  const fromFile = COL_CN[fileOf(m.from[0])];
  const toFile = COL_CN[fileOf(m.to[0])];
  const sameFile = m.from[0] === m.to[0];
  if (sameFile) {
    if (m.to[1] === m.from[1]) return char + fromFile + '平' + toFile;
    const dir = isRed ? (m.to[1] < m.from[1] ? '进' : '退') : (m.to[1] > m.from[1] ? '进' : '退');
    return char + fromFile + dir + COL_CN[Math.abs(m.to[1] - m.from[1])];
  }
  if (m.to[1] === m.from[1]) return char + fromFile + '平' + toFile;
  const dir = isRed ? (m.to[1] < m.from[1] ? '进' : '退') : (m.to[1] > m.from[1] ? '进' : '退');
  return char + fromFile + dir + toFile;
}

function material(board) {
  const VAL = { R: 9, N: 4, B: 2, A: 2, C: 4.5, P: 1, K: 0 };
  let red = 0, black = 0;
  for (const p of board.cells) {
    if (!p) continue;
    const v = VAL[p.toUpperCase()] || 0;
    if (p === p.toUpperCase()) red += v; else black += v;
  }
  return { red, black };
}

const board = new Board();
const log = [];
let ply = 0;

console.log('对局开始：我方（红 · 深度6搜索） vs 大师级（黑 · 深度12）');
console.log('='.repeat(64));

while (ply < 300) {
  const st = board.gameStatus();
  if (st.over) {
    console.log('='.repeat(64));
    console.log(`对局结束：${st.winner === RED ? '红方（我方）胜' : st.winner === BLACK ? '黑方（大师）胜' : '和棋'} — ${st.reason}`);
    break;
  }

  const isRed = board.side === RED;
  const t0 = Date.now();
  let res;
  if (isRed) {
    // 我方：用深度 6 认真下
    clearTT();
    res = searchBestMove(board, { maxDepth: 6, timeLimitMs: 3000 });
  } else {
    // 大师档 AI
    res = chooseMove(board, 'master');
  }
  const dt = Date.now() - t0;

  if (!res || !res.move) { console.log('无着可走'); break; }

  const text = moveToChinese(board, res.move);
  const cap = board.pieceAt(res.move.to[0], res.move.to[1]);
  board.makeMove(res.move);
  ply++;

  if (isRed) {
    log.push({ n: Math.ceil(ply / 2), red: text, redCap: cap });
    const mt = material(board);
    console.log(`${String(Math.ceil(ply / 2)).padStart(2)}. 红 ${text.padEnd(6)}${cap ? '(吃' + PIECE_CHARS[cap] + ')' : '      '} | 子力 红${mt.red} : 黑${mt.black} | ${dt}ms`);
  } else {
    if (log.length) log[log.length - 1].black = text;
    console.log(`   黑 ${text.padEnd(6)}${cap ? '(吃' + PIECE_CHARS[cap] + ')' : '      '} | ${dt}ms`);
  }
}

console.log('='.repeat(64));
console.log(`总步数：${ply} 步（${Math.ceil(ply / 2)} 回合）`);
const mt = material(board);
console.log(`最终子力：红 ${mt.red} : 黑 ${mt.black}`);
