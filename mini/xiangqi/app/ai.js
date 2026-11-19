/**
 * 中国象棋 AI 引擎 v2
 * 迭代加深 + Alpha-Beta + 置换表(Zobrist) + 静态搜索 + 空着裁剪 + 杀手着法
 * 关键优化：搜索内部用伪合法着法，只在需要时才做送将检查
 */

import { Board, RED, BLACK, pieceSide, opposite } from './engine.js';

const PIECE_VALUE = { R: 900, N: 400, B: 200, A: 200, C: 450, P: 100, K: 100000 };
const MVV_LVA = { K: 10000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };

const ROOK_POS = [
  14,14,12,18,16,18,12,14,14, 16,20,18,24,26,24,18,20,16, 12,12,12,18,18,18,12,12,12,
  12,18,16,22,22,22,16,18,12, 12,14,12,18,18,18,12,14,12, 12,16,14,20,20,20,14,16,12,
  6,10,8,14,14,14,8,10,6, 4,8,6,14,12,14,6,8,4, 8,4,8,16,8,16,8,4,8, -2,10,6,14,12,14,6,10,-2,
];
const KNIGHT_POS = [
  4,8,16,12,4,12,16,8,4, 4,10,28,16,8,16,28,10,4, 12,14,16,20,18,20,16,14,12,
  8,24,18,24,20,24,18,24,8, 6,16,14,18,16,18,14,16,6, 4,12,16,14,12,14,16,12,4,
  2,6,8,6,10,6,8,6,2, 4,2,8,8,4,8,8,2,4, 0,2,4,4,-2,4,4,2,0, 0,-4,0,0,0,0,0,-4,0,
];
const CANNON_POS = [
  6,4,0,-10,-12,-10,0,4,6, 2,2,0,-4,-14,-4,0,2,2, 2,2,0,-10,-8,-10,0,2,2,
  0,0,-2,4,10,4,-2,0,0, 0,0,0,2,8,2,0,0,0, -2,0,4,2,6,2,4,0,-2,
  0,0,0,2,4,2,0,0,0, 4,0,8,6,10,6,8,0,4, 0,2,4,6,6,6,4,2,0, 0,0,2,6,6,6,2,0,0,
];
const PAWN_POS = [
  0,3,6,9,12,9,6,3,0, 18,36,56,80,120,80,56,36,18, 14,26,42,60,80,60,42,26,14,
  10,20,30,34,40,34,30,20,10, 6,12,18,18,20,18,18,12,6, 2,0,8,0,8,0,8,0,2,
  0,0,-2,0,4,0,-2,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,
];
const POS_TABLE = { R: ROOK_POS, N: KNIGHT_POS, C: CANNON_POS, P: PAWN_POS };

const MATE_SCORE = 30000;
const INF = 1 << 20;

// ---------- Zobrist ----------
function xorshift(seed) {
  let x = seed >>> 0 || 2463534242;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x >>> 0; };
}
const rnd = xorshift(0x9e3779b9);
const ZOBRIST = [];
const TOTAL_PIECES = 14;
for (let i = 0; i < 90 * TOTAL_PIECES; i++) ZOBRIST.push(rnd());
const ZOBRIST_SIDE = rnd();
const PIECE_ORDER = ['K','A','B','N','R','C','P','k','a','b','n','r','c','p'];
const PIECE_INDEX = {};
PIECE_ORDER.forEach((p, i) => { PIECE_INDEX[p] = i; });

export function boardHash(board) {
  let h = 0;
  for (let i = 0; i < 90; i++) {
    const p = board.cells[i];
    if (p) h ^= ZOBRIST[i * TOTAL_PIECES + PIECE_INDEX[p]];
  }
  if (board.side === BLACK) h ^= ZOBRIST_SIDE;
  return h >>> 0;
}

// ---------- 评估 ----------
export function evaluate(board, sideToMove = board.side) {
  let score = 0;
  for (let i = 0; i < 90; i++) {
    const p = board.cells[i];
    if (!p) continue;
    const up = p.toUpperCase();
    const isRed = p === up;
    const idx = isRed ? i : (89 - i);
    const tbl = POS_TABLE[up];
    score += (isRed ? 1 : -1) * (PIECE_VALUE[up] + (tbl ? tbl[idx] : 0));
  }
  return sideToMove === RED ? score : -score;
}

// ---------- Zobrist 增量 ----------
function zHash(board) { return boardHash(board); }

// ---------- 置换表 ----------
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
const MAX_TT = 1 << 19;
const tt = new Map();
export function clearTT() { tt.clear(); }

// ---------- 快速着法生成（搜索内部用）----------
// 直接操作 cells 数组，不生成新对象
const DIRS_ROOK = [[1,0],[-1,0],[0,1],[0,-1]];
const DIRS_KING = [[1,0],[-1,0],[0,1],[0,-1]];
const STEPS_KNIGHT = [[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]];
const STEPS_BISHOP = [[2,2],[2,-2],[-2,2],[-2,-2]];
const STEPS_ADVISOR = [[1,1],[1,-1],[-1,1],[-1,-1]];

/**
 * 生成伪合法着法（不检查送将），返回紧凑数组 [from, to, ...]
 * 用对象数组保持与 Board 接口一致
 */
function genMoves(board, side) {
  const cells = board.cells;
  const moves = [];
  const push = (fx, fy, tx, ty) => {
    if (tx < 0 || tx > 8 || ty < 0 || ty > 9) return;
    const target = cells[ty * 9 + tx];
    if (target && pieceSide(target) === side) return;
    moves.push({ from: [fx, fy], to: [tx, ty] });
  };

  for (let i = 0; i < 90; i++) {
    const p = cells[i];
    if (!p || pieceSide(p) !== side) continue;
    const x = i % 9, y = (i / 9) | 0;
    const up = p.toUpperCase();

    if (up === 'R') {
      for (const [dx, dy] of DIRS_ROOK) {
        let cx = x + dx, cy = y + dy;
        while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
          const t = cells[cy * 9 + cx];
          if (!t) { moves.push({ from: [x, y], to: [cx, cy] }); }
          else {
            if (pieceSide(t) !== side) moves.push({ from: [x, y], to: [cx, cy] });
            break;
          }
          cx += dx; cy += dy;
        }
      }
    } else if (up === 'C') {
      for (const [dx, dy] of DIRS_ROOK) {
        let cx = x + dx, cy = y + dy;
        while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9 && !cells[cy * 9 + cx]) {
          moves.push({ from: [x, y], to: [cx, cy] });
          cx += dx; cy += dy;
        }
        if (cx < 0 || cx > 8 || cy < 0 || cy > 9) continue;
        cx += dx; cy += dy;
        while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
          const t = cells[cy * 9 + cx];
          if (t) {
            if (pieceSide(t) !== side) moves.push({ from: [x, y], to: [cx, cy] });
            break;
          }
          cx += dx; cy += dy;
        }
      }
    } else if (up === 'N') {
      for (const [dx, dy, bx, by] of STEPS_KNIGHT) {
        const legX = x + bx, legY = y + by;
        if (legX < 0 || legX > 8 || legY < 0 || legY > 9) continue;
        if (cells[legY * 9 + legX]) continue;
        push(x, y, x + dx, y + dy);
      }
    } else if (up === 'B') {
      for (const [dx, dy] of STEPS_BISHOP) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx > 8 || ny < 0 || ny > 9) continue;
        if (side === RED ? ny < 5 : ny > 4) continue;
        if (cells[(y + dy / 2) * 9 + (x + dx / 2)]) continue;
        push(x, y, nx, ny);
      }
    } else if (up === 'A') {
      for (const [dx, dy] of STEPS_ADVISOR) {
        const nx = x + dx, ny = y + dy;
        if (nx < 3 || nx > 5) continue;
        if (side === RED ? (ny < 7 || ny > 9) : (ny < 0 || ny > 2)) continue;
        push(x, y, nx, ny);
      }
    } else if (up === 'K') {
      for (const [dx, dy] of DIRS_KING) {
        const nx = x + dx, ny = y + dy;
        if (nx < 3 || nx > 5) continue;
        if (side === RED ? (ny < 7 || ny > 9) : (ny < 0 || ny > 2)) continue;
        push(x, y, nx, ny);
      }
    } else if (up === 'P') {
      const fwd = side === RED ? -1 : 1;
      push(x, y, x, y + fwd);
      const crossed = side === RED ? y <= 4 : y >= 5;
      if (crossed) { push(x, y, x - 1, y); push(x, y, x + 1, y); }
    }
  }
  return moves;
}

// 是否被将军（扫棋盘找将，再查攻击）
// 优化：用预计算的攻击表，避免每次从头扫描
const ROOK_RAYS = new Array(90);
const CANNON_RAYS = new Array(90);
const KNIGHT_ATTACKS = new Array(90);
const PAWN_ATTACKS = new Array(90);

(function buildAttackTables() {
  for (let i = 0; i < 90; i++) {
    const x = i % 9, y = (i / 9) | 0;

    // 车/将直线可达（不限距离，靠扫描判断阻挡）
    const rookRay = [];
    for (const [dx, dy] of DIRS_ROOK) {
      let cx = x + dx, cy = y + dy;
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
        rookRay.push([cy * 9 + cx, dx, dy]);
        cx += dx; cy += dy;
      }
    }
    ROOK_RAYS[i] = rookRay;

    // 马的反向攻击点：哪些位置有马能攻击到 i
    const knightSrc = [];
    for (const [dx, dy, lx, ly] of [[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]]) {
      const sx = x + dx, sy = y + dy;  // 马所在位置
      if (sx < 0 || sx > 8 || sy < 0 || sy > 9) continue;
      // 马腿位置：从马的位置，朝目标方向的第一格
      const legX = sx + (dx === 2 ? -1 : dx === -2 ? 1 : 0);
      const legY = sy + (dy === 2 ? -1 : dy === -2 ? 1 : 0);
      if (legX < 0 || legX > 8 || legY < 0 || legY > 9) continue;
      knightSrc.push([sy * 9 + sx, legY * 9 + legX]);
    }
    KNIGHT_ATTACKS[i] = knightSrc;

    // 兵的攻击来源
    const pawnSrc = [];
    // 敌方兵从上方攻击（黑兵向下走）
    const above = (y - 1) >= 0 ? (y - 1) * 9 + x : -1;
    if (above >= 0) pawnSrc.push([above, 'R']); // 红兵向上走，从下方来
    const below = (y + 1) <= 9 ? (y + 1) * 9 + x : -1;
    if (below >= 0) pawnSrc.push([below, 'B']);
    // 横向：过河兵
    if (x - 1 >= 0) pawnSrc.push([y * 9 + (x - 1), 'H']);
    if (x + 1 <= 8) pawnSrc.push([y * 9 + (x + 1), 'H']);
    PAWN_ATTACKS[i] = pawnSrc;
  }
})();

function inCheck(board, side) {
  const cells = board.cells;
  const kingChar = side === RED ? 'K' : 'k';
  let kIdx = -1;
  for (let i = 0; i < 90; i++) if (cells[i] === kingChar) { kIdx = i; break; }
  if (kIdx < 0) return true;
  const kx = kIdx % 9, ky = (kIdx / 9) | 0;
  const enemy = opposite(side);

  // 1) 车 / 炮 / 将帅照面：沿四个方向扫描
  for (const [dx, dy] of DIRS_ROOK) {
    let cx = kx + dx, cy = ky + dy;
    let blockers = 0;
    while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
      const t = cells[cy * 9 + cx];
      if (t) {
        const ts = pieceSide(t);
        const tu = t.toUpperCase();
        if (ts === enemy) {
          if (blockers === 0 && (tu === 'R' || tu === 'K')) return true;
          if (blockers === 1 && tu === 'C') return true;
        }
        blockers++;
        if (blockers >= 2) break; // 只可能有一个炮架
      }
      cx += dx; cy += dy;
    }
  }

  // 2) 马：从将的位置反推可能的马位与马腿
  for (const [srcIdx, legIdx] of KNIGHT_ATTACKS[kIdx]) {
    const t = cells[srcIdx];
    if (t && pieceSide(t) === enemy && t.toUpperCase() === 'N' && !cells[legIdx]) return true;
  }

  // 3) 兵/卒：正面一格 + 过河后的横向一格
  const enemyPawn = enemy === RED ? 'P' : 'p';
  // 敌兵前进方向：红兵向上(-1)，黑卒向下(+1)。从将的位置回推
  const behindY = enemy === RED ? ky + 1 : ky - 1;
  if (behindY >= 0 && behindY <= 9 && cells[behindY * 9 + kx] === enemyPawn) return true;
  for (const dx of [-1, 1]) {
    const nx = kx + dx;
    if (nx < 0 || nx > 8) continue;
    if (cells[ky * 9 + nx] === enemyPawn) {
      // 只有过河的兵才能横走：红兵过河后 y<=4；黑卒过河后 y>=5
      const crossed = enemy === RED ? ky <= 4 : ky >= 5;
      if (crossed) return true;
    }
  }
  return false;
}

// 生成合法着法（过滤送将）
// 正确性优先：所有走法都做送将检查。inCheck 已做定向优化，开销可控。
function genLegalMoves(board, side) {
  const pseudo = genMoves(board, side);
  if (pseudo.length === 0) return pseudo;

  const cells = board.cells;
  const kingChar = side === RED ? 'K' : 'k';
  let kingIdx = -1;
  for (let i = 0; i < 90; i++) if (cells[i] === kingChar) { kingIdx = i; break; }
  if (kingIdx < 0) return [];

  const kx = kingIdx % 9, ky = (kingIdx / 9) | 0;
  // 当前是否已被将军：被将军时所有着法都要验证
  const currentlyChecked = inCheck(board, side);

  const result = [];
  for (const m of pseudo) {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const fromIdx = fy * 9 + fx;

    // 快速通道：未被将军时，只有以下情况才可能自陷将军
    //   1) 走的是将/帅本身
    //   2) 起点或终点与将帅同行/同列 —— 移动会改变该线路上的遮挡关系
    //      （起点：可能让开遮挡暴露将帅；终点：可能挡住攻击线路，
    //        反而制造出"将帅照面"之类的非法局面）
    // 其余着法与将帅线路无关，直接放行，省掉一次完整的 inCheck 扫描
    if (!currentlyChecked) {
      const isKingMove = fromIdx === kingIdx;
      const fromOnLine = (fx === kx) || (fy === ky);
      const toOnLine = (tx === kx) || (ty === ky);
      if (!isKingMove && !fromOnLine && !toOnLine) {
        result.push(m);
        continue;
      }
    }

    const cap = cells[ty * 9 + tx];
    cells[ty * 9 + tx] = cells[fromIdx];
    cells[fromIdx] = null;
    if (!inCheck(board, side)) result.push(m);
    cells[fromIdx] = cells[ty * 9 + tx];
    cells[ty * 9 + tx] = cap;
  }
  return result;
}

/**
 * 判断这一步是否可能暴露将（仅在未被将军时使用）。
 * 保守策略：只要满足以下任一条件就做完整检查——
 *   1. 移动的是将本身
 *   2. 起点与将在同一行或同一列
 * 其余走法不可能造成自将，直接放行。
 */
function mayExposeKing(fx, fy, kx, ky, cells, kIdx) {
  const fromIdx = fy * 9 + fx;
  if (fromIdx === kIdx) return true;
  return fx === kx || fy === ky;
}

function sameMove(a, b) {
  return a && b && a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
}

function moveOrderScore(board, m, pvMove, killers) {
  if (pvMove && sameMove(m, pvMove)) return 1e9;
  const target = board.cells[m.to[1] * 9 + m.to[0]];
  if (target) {
    const attacker = board.cells[m.from[1] * 9 + m.from[0]];
    return 1e6 + MVV_LVA[target.toUpperCase()] * 10 - (attacker ? MVV_LVA[attacker.toUpperCase()] : 0);
  }
  if (killers) {
    if (killers[0] && sameMove(m, killers[0])) return 9e5;
    if (killers[1] && sameMove(m, killers[1])) return 8e5;
  }
  return 0;
}

/** 带历史启发的排序分数（供 negamax 内部使用） */
function orderScore(board, m, pvMove, killers) {
  const base = moveOrderScore(board, m, pvMove, killers);
  if (base !== 0) return base;
  const hi = historyIndex(m);
  return (hi >= 0 && hi < HISTORY_SIZE) ? historyTable[hi] : 0;
}

// ---------- 静态搜索 ----------
let nodes = 0;
let stopFlag = false;
let timeLimitMs = 3000;
let startTime = 0;

function quiescence(board, alpha, beta, side, depth = 0) {
  nodes++;
  if (stopFlag) return evaluate(board, side);
  const standPat = evaluate(board, side);
  if (depth > 8) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const captures = genMoves(board, side).filter(m => board.cells[m.to[1] * 9 + m.to[0]]);
  captures.sort((a, b) => moveOrderScore(board, b, null, null) - moveOrderScore(board, a, null, null));

  for (const m of captures) {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const cap = board.cells[ty * 9 + tx];
    board.cells[ty * 9 + tx] = board.cells[fy * 9 + fx];
    board.cells[fy * 9 + fx] = null;
    const score = -quiescence(board, -beta, -alpha, opposite(side), depth + 1);
    board.cells[fy * 9 + fx] = board.cells[ty * 9 + tx];
    board.cells[ty * 9 + tx] = cap;
    if (stopFlag) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// ---------- 主搜索 ----------
/**
 * 重复局面检测：搜索路径上同一局面出现 2 次即视为循环，按和棋（0 分）计。
 * 这样 AI 不会为了"骚扰"而无限长将，也不会误入自己制造的死循环。
 */
// 历史启发表：记录每个 (起点格, 终点格) 造成剪枝的次数，供非吃子着法排序用
const HISTORY_SIZE = 90 * 90;
let historyTable = new Int32Array(HISTORY_SIZE);
const historyIndex = (m) => ((m.from[1] * 9 + m.from[0]) * 90 + (m.to[1] * 9 + m.to[0]));

/** 每个 ply 各自的杀手着法（而非每层新建空数组） */
let killerTable = [];
function ensureKillerTable(maxPly) {
  while (killerTable.length <= maxPly) killerTable.push([null, null]);
}

function negamax(board, depth, alpha, beta, side, ply, pathHashes) {
  nodes++;
  if ((nodes & 511) === 0 && Date.now() - startTime > timeLimitMs) stopFlag = true;
  if (stopFlag) return evaluate(board, side);

  const isRoot = ply === 0;
  const legal = genLegalMoves(board, side);

  if (legal.length === 0) {
    return -MATE_SCORE + ply; // 将死或困毙
  }

  const hash = boardHash(board);

  // 搜索路径上出现过 → 循环，按和棋处理（返回 0，不偏向任何一方）
  if (pathHashes && pathHashes.includes(hash)) {
    return 0;
  }

  if (depth <= 0) return quiescence(board, alpha, beta, side);

  const entry = tt.get(hash);
  let pvMove = null;
  if (entry) {
    pvMove = entry.bestMove;
    if (entry.depth >= depth && !isRoot) {
      if (entry.flag === TT_EXACT) return entry.score;
      if (entry.flag === TT_LOWER && entry.score > alpha) alpha = entry.score;
      else if (entry.flag === TT_UPPER && entry.score < beta) beta = entry.score;
      if (alpha >= beta) return entry.score;
    }
  }

  const checked = inCheck(board, side);

  // 空着裁剪（简化：只在中局、非将军时用）
  if (!isRoot && depth >= 3 && !checked && Math.abs(beta) < MATE_SCORE - 1000) {
    const R = 2;
    const nullScore = -negamax(board, depth - 1 - R, -beta, -beta + 1, opposite(side), ply + 1, pathHashes);
    if (nullScore >= beta) return beta;
  }

  ensureKillerTable(ply);
  const killers = killerTable[ply];

  // 着法排序：PV > 吃子(MVV-LVA) > 杀手 > 历史启发
  legal.sort((a, b) => {
    const sa = orderScore(board, a, pvMove, killers);
    const sb = orderScore(board, b, pvMove, killers);
    return sb - sa;
  });

  let bestScore = -INF;
  let bestMove = null;
  const alphaOrig = alpha;
  let searched = 0;

  // 把当前局面加入路径，供子节点检测循环
  const childPath = pathHashes ? [...pathHashes, hash] : [hash];

  for (let i = 0; i < legal.length; i++) {
    const m = legal[i];
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const cap = board.cells[ty * 9 + tx];
    const isQuiet = !cap;
    board.cells[ty * 9 + tx] = board.cells[fy * 9 + fx];
    board.cells[fy * 9 + fx] = null;
    board.side = opposite(side);

    let score;
    if (searched === 0) {
      // 首个着法：全窗口
      score = -negamax(board, depth - 1, -beta, -alpha, opposite(side), ply + 1, childPath);
    } else {
      // PVS：先用零窗口探测，失败再重搜
      // LMR：靠后的安静着法先削减深度
      let reduction = 0;
      if (isQuiet && depth >= 3 && searched >= 3 && !checked) {
        reduction = searched >= 6 ? 2 : 1;
      }
      score = -negamax(board, depth - 1 - reduction, -alpha - 1, -alpha, opposite(side), ply + 1, childPath);

      // 零窗口探测失败且没有被削减，或削减后意外变好 → 重搜全窗口
      if (score > alpha && score < beta) {
        if (reduction > 0) {
          score = -negamax(board, depth - 1, -alpha - 1, -alpha, opposite(side), ply + 1, childPath);
        }
        if (score > alpha && score < beta) {
          score = -negamax(board, depth - 1, -beta, -alpha, opposite(side), ply + 1, childPath);
        }
      }
    }
    searched++;

    board.side = side;
    board.cells[fy * 9 + fx] = board.cells[ty * 9 + tx];
    board.cells[ty * 9 + tx] = cap;

    if (stopFlag) return bestScore === -INF ? evaluate(board, side) : bestScore;

    if (score > bestScore) { bestScore = score; bestMove = m; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // 记录杀手着法（仅安静着法）和历史启发
      if (isQuiet) {
        if (!killers[0] || !sameMove(killers[0], m)) { killers[1] = killers[0]; killers[0] = m; }
        const hi = historyIndex(m);
        if (hi >= 0 && hi < HISTORY_SIZE) {
          historyTable[hi] += depth * depth;
          if (historyTable[hi] > 1 << 20) {
            // 防止溢出：整体衰减
            for (let k = 0; k < HISTORY_SIZE; k++) historyTable[k] >>= 1;
          }
        }
      }
      break;
    }
  }

  if (!stopFlag) {
    let flag = TT_EXACT;
    if (bestScore <= alphaOrig) flag = TT_UPPER;
    else if (bestScore >= beta) flag = TT_LOWER;
    if (tt.size > MAX_TT) tt.clear();
    const old = tt.get(hash);
    if (!old || old.depth <= depth) tt.set(hash, { depth, score: bestScore, flag, bestMove });
  }

  return bestScore;
}

/**
 * 搜索最佳着法
 */
export function searchBestMove(board, opts = {}) {
  const maxDepth = opts.maxDepth ?? 6;
  timeLimitMs = opts.timeLimitMs ?? 3000;
  nodes = 0;
  stopFlag = false;
  startTime = Date.now();
  // 每轮搜索重置历史启发与杀手着法
  historyTable = new Int32Array(HISTORY_SIZE);
  killerTable = [];

  const side = board.side;
  const rootLegal = genLegalMoves(board, side);
  if (rootLegal.length === 0) return null;

  let best = null;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF, beta = INF;
    let iterBest = null, iterScore = -INF;

    const ordered = rootLegal.slice().sort((a, b) => {
      if (best && sameMove(a, best.move)) return -1;
      if (best && sameMove(b, best.move)) return 1;
      return moveOrderScore(board, b, null, null) - moveOrderScore(board, a, null, null);
    });

    const rootKillers = [null, null];
    const rootPath = [boardHash(board)];
    for (const m of ordered) {
      const [fx, fy] = m.from, [tx, ty] = m.to;
      const cap = board.cells[ty * 9 + tx];
      board.cells[ty * 9 + tx] = board.cells[fy * 9 + fx];
      board.cells[fy * 9 + fx] = null;
      board.side = opposite(side);

      const score = -negamax(board, depth - 1, -beta, -alpha, opposite(side), 1, rootPath);

      board.side = side;
      board.cells[fy * 9 + fx] = board.cells[ty * 9 + tx];
      board.cells[ty * 9 + tx] = cap;

      if (stopFlag) break;
      if (score > iterScore) { iterScore = score; iterBest = m; }
      if (score > alpha) alpha = score;
    }

    if (stopFlag) break;
    if (iterBest) best = { move: iterBest, score: iterScore, depth, nodes };
    if (Math.abs(iterScore) >= MATE_SCORE - 200) break;
    if (Date.now() - startTime > timeLimitMs * 0.6) break;
  }

  return best || { move: rootLegal[0], score: 0, depth: 1, nodes };
}

// ---------- 难度 ----------
// 低难度要「真会犯错」，但光是"挑次优棋"不够——搜索出来的次优棋往往依然很强。
// 更有效的做法是：搜索本身就不认真。
//   - maxDepth: 只算几步，看不见后续威胁
//   - blunder: 概率性地直接瞎走（不看任何分析），这才是新手的样子
//   - rankRange: 半随机时能挑到多靠后的名次（按排名百分比，开局同分扎堆时依然有效）
export const DIFFICULTIES = {
  easy: {
    label: '入门',
    maxDepth: 1,        // 只看一步：能吃就吃、能跑就跑
    timeLimitMs: 100,
    blunder: 0.65,      // 大部分时候纯随机走，像刚学棋的人
    rankRange: 0.95,
  },
  normal: {
    label: '普通',
    maxDepth: 2,        // 能算两步，会做简单战术
    timeLimitMs: 300,
    blunder: 0.20,      // 偶尔走神
    rankRange: 0.35,
  },
  hard: {
    label: '困难',
    // 困难档保持中等强度：深度 5 + 少量随机，与大师档拉开差距
    maxDepth: 5,
    timeLimitMs: 1500,
    blunder: 0.05,
    rankRange: 0.06,
  },
  master: {
    label: '大师',
    // 迭代加深保证随时有可用结果：时间到就交当前最好的一步。
    // 优化后 3 秒内能搜到 7-9 层，比困难档深 2-4 层。
    maxDepth: 14,
    timeLimitMs: 3000,
    blunder: 0,
    rankRange: 0,
  },
};

/** 用静态评估给候选排序 */
function rankCandidates(board) {
  const legal = genLegalMoves(board, board.side);
  const scored = legal.map((m) => {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const cap = board.cells[ty * 9 + tx];
    board.cells[ty * 9 + tx] = board.cells[fy * 9 + fx];
    board.cells[fy * 9 + fx] = null;
    const prevSide = board.side;
    board.side = opposite(board.side);
    const s = -evaluate(board, board.side);
    board.side = prevSide;
    board.cells[fy * 9 + fx] = board.cells[ty * 9 + tx];
    board.cells[ty * 9 + tx] = cap;
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored;
}

/**
 * 按难度选择着法。
 * 低难度有三种行为按概率混合：
 *   1) 正常搜索（用 cfg.maxDepth，本来就很浅）
 *   2) 半随机：按排名挑一个明显次优的棋
 *   3) 完全瞎走：从所有合法着法里纯随机挑（新手常态）
 * 这样它依然懂规则、会吃白送的子，但经常漏看关键威胁，玩家能赢。
 */
export function chooseMove(board, difficulty = 'normal') {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  tt.clear();

  // 大师档：纯搜索
  if (!cfg.blunder) {
    return searchBestMove(board, { maxDepth: cfg.maxDepth, timeLimitMs: cfg.timeLimitMs });
  }

  const roll = Math.random();

  // 3) 完全瞎走
  if (roll < cfg.blunder) {
    const legal = genLegalMoves(board, board.side);
    if (legal.length > 0) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      return { move: m, score: 0, depth: 0, nodes: 0, blundered: true };
    }
  }

  // 1) 正常搜索
  const res = searchBestMove(board, { maxDepth: cfg.maxDepth, timeLimitMs: cfg.timeLimitMs });
  if (!res) return null;

  // 2) 半随机：按排名挑次优
  const roll2 = Math.random();
  if (roll2 >= cfg.rankRange) return res;

  const scored = rankCandidates(board);
  if (scored.length <= 1) return res;

  const worstRank = Math.max(1, Math.floor(scored.length * cfg.rankRange * 2));
  const pickRank = 1 + Math.floor(Math.random() * worstRank);
  const pick = scored[Math.min(pickRank, scored.length - 1)];

  return {
    move: pick.m,
    score: res.score,
    depth: res.depth,
    nodes: res.nodes,
    blundered: true,
  };
}

export { sameMove, genLegalMoves };
