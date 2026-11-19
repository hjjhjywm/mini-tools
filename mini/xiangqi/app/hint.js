/**
 * AI 指导模块
 * 基于本地引擎分析当前局面，给出推荐着法 + 人能看懂的理由。
 * 不依赖网络、不花钱、毫秒级返回。
 */

import { Board, RED, BLACK, PIECE_CHARS, pieceSide, opposite } from './engine.js';
import { searchBestMove, evaluate, clearTT } from './ai.js';

// 子力价值（与 ai.js 评估保持一致）
const HINT_PIECE_VALUE = { R: 900, N: 400, B: 200, A: 200, C: 450, P: 100, K: 100000 };

// 中文记谱用
const HINT_COL_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 把着法转成中文记谱（车二平五 / 马八进七） */
export function moveToChinese(board, m) {
  const p = board.pieceAt(m.from[0], m.from[1]);
  if (!p) return '?';
  const isRed = pieceSide(p) === RED;
  const char = PIECE_CHARS[p];
  const fileOf = (x) => (isRed ? 9 - x : x + 1);
  const fromFile = HINT_COL_CN[fileOf(m.from[0])];
  const toFile = HINT_COL_CN[fileOf(m.to[0])];
  const sameFile = m.from[0] === m.to[0];
  if (m.to[1] === m.from[1]) return char + fromFile + '平' + toFile;
  const dir = isRed ? (m.to[1] < m.from[1] ? '进' : '退') : (m.to[1] > m.from[1] ? '进' : '退');
  if (sameFile) return char + fromFile + dir + HINT_COL_CN[Math.abs(m.to[1] - m.from[1])];
  return char + fromFile + dir + toFile;
}

/** 子力总值（不含将帅） */
function materialOf(board, side) {
  let sum = 0;
  for (const p of board.cells) {
    if (!p) continue;
    const isRed = p === p.toUpperCase();
    if ((isRed ? RED : BLACK) !== side) continue;
    const v = HINT_PIECE_VALUE[p.toUpperCase()];
    if (p.toUpperCase() !== 'K') sum += v;
  }
  return sum;
}

/**
 * 分析某个着法走完之后的影响
 * @returns {{text: string, score: number, kind: string}}
 */
function analyzeMove(board, move) {
  const b = board.clone();
  const mover = board.side;
  const captured = b.pieceAt(move.to[0], move.to[1]);
  const movingPiece = b.pieceAt(move.from[0], move.from[1]);

  b.makeMove({ from: move.from.slice(), to: move.to.slice() });

  const reasons = [];
  let kind = 'normal';

  // 1) 吃子
  if (captured) {
    const gain = HINT_PIECE_VALUE[captured.toUpperCase()] || 0;
    reasons.push(`吃掉对方${PIECE_CHARS[captured]}（价值约 ${gain} 分）`);
    kind = 'capture';
  }

  // 2) 将军
  const givesCheck = b.isChecked(b.side);
  if (givesCheck) {
    reasons.push('形成将军，逼迫对方应手');
    kind = 'check';
  }

  // 3) 走后自己是否被反吃，并算出净收益
  const enemy = b.side;
  const enemyMoves = b.legalMoves(enemy);
  const eatBack = enemyMoves.find(
    (m) => m.to[0] === move.to[0] && m.to[1] === move.to[1]
  );
  if (eatBack) {
    const myValue = HINT_PIECE_VALUE[movingPiece.toUpperCase()] || 0;
    const gainValue = captured ? (HINT_PIECE_VALUE[captured.toUpperCase()] || 0) : 0;
    const net = gainValue - myValue;

    if (net < -50) {
      // 亏本交换：吃掉小的、被吃大的
      reasons.push(
        `⚠ 这步是亏本交换：吃${captured ? PIECE_CHARS[captured] : '子'}得 ${gainValue} 分，` +
        `但${PIECE_CHARS[movingPiece]}会被反吃损失 ${myValue} 分（净亏 ${Math.abs(net)} 分）`
      );
      kind = 'risky';
    } else if (net > 50) {
      reasons.push(
        `这枚${PIECE_CHARS[movingPiece]}虽然会被吃回，但净赚 ${net} 分（吃${PIECE_CHARS[captured]} ${gainValue} - 失${PIECE_CHARS[movingPiece]} ${myValue}）`
      );
    } else if (myValue >= 400) {
      reasons.push(`⚠ 这枚${PIECE_CHARS[movingPiece]}会被对方吃掉（损失约 ${myValue} 分）`);
      kind = 'risky';
    } else {
      reasons.push('可能被对方吃掉，但损失不大');
    }
  }

  // 4) 是否把对方将死/困毙
  const enemyStatus = b.gameStatus();
  if (enemyStatus.over && enemyStatus.winner === mover) {
    reasons.push(`直接${enemyStatus.reason}对方，这步就赢了`);
    kind = 'mate';
  }

  // 5) 用引擎打分（从走子方视角）
  clearTT();
  const res = searchBestMove(b, { maxDepth: 4, timeLimitMs: 600 });
  const score = res ? -res.score : -evaluate(b, b.side);

  return { reasons, score, kind, givesCheck };
}

/**
 * 生成指导建议
 * @param {Board} board 当前局面
 * @param {object} opts { depth, timeLimit }
 * @returns {{
 *   move: {from:number[],to:number[]},
 *   notation: string,
 *   score: number,
 *   summary: string,
 *   reasons: string[],
 *   material: {mine:number, theirs:number},
 *   inCheck: boolean,
 *   depth: number
 * } | null}
 */
export function getHint(board, opts = {}) {
  if (!board) return null;
  const legal = board.legalMoves(board.side);
  if (legal.length === 0) return null;

  const depth = opts.depth ?? 10;
  const timeLimit = opts.timeLimit ?? 2500;

  // 1) 先用引擎找最佳着法
  clearTT();
  const best = searchBestMove(board, { maxDepth: depth, timeLimitMs: timeLimit });
  if (!best || !best.move) return null;

  // 2) 校验：如果推荐的是明显亏本交换，就换一个次优但安全的着法。
  //    浅层搜索常看不透"吃了会被反吃"，这里用静态子力差做一道兜底。
  let chosen = best.move;
  let detail = analyzeMove(board, chosen);
  if (detail.kind === 'risky') {
    // 在同分区间内找一个不会亏本交换的替代着法
    const candidates = legal
      .map((m) => ({ m, d: analyzeMove(board, m) }))
      .filter((c) => c.d.kind !== 'risky')
      .sort((a, b2) => b2.d.score - a.d.score);
    if (candidates.length > 0) {
      chosen = candidates[0].m;
      detail = candidates[0].d;
    }
  }

  // 3) 组装理由
  const reasons = detail.reasons.slice();

  // 3a) 如果没有任何明显理由，补一句局面性说明
  if (reasons.length === 0) {
    const mine = materialOf(board, board.side);
    const theirs = materialOf(board, opposite(board.side));
    const diff = mine - theirs;
    if (detail.givesCheck) {
      reasons.push('占据主动，压制对方将/帅');
    } else if (diff > 300) {
      reasons.push('稳住已有优势，不给对方翻盘机会');
    } else if (diff < -300) {
      reasons.push('处于劣势，先走稳健着法保住子力');
    } else {
      reasons.push('改善子力位置，为后续进攻做准备');
    }
  }

  // 3b) 分数换算成人话
  const s = detail.score;
  let scoreText;
  if (Math.abs(s) > 20000) scoreText = s > 0 ? '必胜' : '必败';
  else if (s > 500) scoreText = '大优';
  else if (s > 150) scoreText = '略优';
  else if (s > -150) scoreText = '势均力敌';
  else if (s > -500) scoreText = '略亏';
  else scoreText = '大劣';

  return {
    move: { from: chosen.from.slice(), to: chosen.to.slice() },
    notation: moveToChinese(board, chosen),
    score: s,
    scoreText,
    summary: `${scoreText}（${s > 0 ? '+' : ''}${Math.round(s)} 分）`,
    reasons,
    material: {
      mine: materialOf(board, board.side),
      theirs: materialOf(board, opposite(board.side)),
    },
    inCheck: board.isChecked(board.side),
    depth: best.depth || 0,
    nodes: best.nodes || 0,
  };
}
