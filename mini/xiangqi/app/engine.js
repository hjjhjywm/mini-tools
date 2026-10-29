/**
 * 中国象棋规则引擎
 * 棋盘 9 列 × 10 行，坐标 (x, y)：x ∈ [0,8] 从左到右，y ∈ [0,9] 从上到下（红方在下，y=9 是红底线）
 * 棋子编码：红方大写 R N B A K C P，黑方小写 r n b a k c p
 *   R/r 车  N/n 马  B/b 象  A/a 士  K/k 将/帅  C/c 炮  P/p 兵/卒
 */

export const RED = 'r';
export const BLACK = 'b';

// 棋盘初始化（FEN 标准起始局面）
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

const PIECE_CHARS = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

export function pieceSide(p) {
  if (!p) return null;
  return p === p.toUpperCase() ? RED : BLACK;
}

export function opposite(side) {
  return side === RED ? BLACK : RED;
}

export class Board {
  constructor() {
    this.cells = new Array(90).fill(null);
    this.side = RED;      // 轮到谁走
    this.history = [];    // [{from,to,captured}] 用于悔棋
    this.positionCounts = new Map(); // 局面指纹 → 出现次数（判和用）
    this.fromFen(START_FEN);
  }

  static fromFen(fen) {
    const b = new Board();
    b.fromFen(fen);
    return b;
  }

  clone() {
    const b = new Board();
    b.cells = this.cells.slice();
    b.side = this.side;
    b.history = this.history.slice();
    b.positionCounts = new Map(this.positionCounts);
    return b;
  }

  fromFen(fen) {
    const [placement, sidePart] = fen.trim().split(' ');
    this.cells = new Array(90).fill(null);
    const rows = placement.split('/');
    for (let y = 0; y < 10; y++) {
      let x = 0;
      for (const ch of rows[y]) {
        if (ch >= '0' && ch <= '9') {
          x += Number(ch);
        } else {
          this.cells[y * 9 + x] = ch;
          x++;
        }
      }
    }
    this.side = sidePart === 'b' ? BLACK : RED;
    this.history = [];
    // 重置重复计数，并记下初始局面
    this.positionCounts = new Map();
    this.positionCounts.set(this.positionKey(), 1);
    return this;
  }

  toFen() {
    let out = '';
    for (let y = 0; y < 10; y++) {
      let empty = 0;
      for (let x = 0; x < 9; x++) {
        const p = this.cells[y * 9 + x];
        if (p) {
          if (empty) { out += empty; empty = 0; }
          out += p;
        } else {
          empty++;
        }
      }
      if (empty) out += empty;
      if (y < 9) out += '/';
    }
    return out + ' ' + (this.side === BLACK ? 'b' : 'r');
  }

  pieceAt(x, y) {
    if (x < 0 || x > 8 || y < 0 || y > 9) return undefined;
    return this.cells[y * 9 + x];
  }

  setPiece(x, y, p) {
    this.cells[y * 9 + x] = p;
  }

  findKing(side) {
    const k = side === RED ? 'K' : 'k';
    for (let i = 0; i < 90; i++) if (this.cells[i] === k) return i;
    return -1;
  }

  /** 生成某方的伪合法着法（不检查走后是否被将军） */
  pseudoMoves(side = this.side) {
    const moves = [];
    for (let i = 0; i < 90; i++) {
      const p = this.cells[i];
      if (!p || pieceSide(p) !== side) continue;
      const x = i % 9, y = (i / 9) | 0;
      const type = p.toUpperCase();
      switch (type) {
        case 'R': this._rookMoves(x, y, side, moves); break;
        case 'C': this._cannonMoves(x, y, side, moves); break;
        case 'N': this._knightMoves(x, y, side, moves); break;
        case 'B': this._bishopMoves(x, y, side, moves); break;
        case 'A': this._advisorMoves(x, y, side, moves); break;
        case 'K': this._kingMoves(x, y, side, moves); break;
        case 'P': this._pawnMoves(x, y, side, moves); break;
      }
    }
    return moves;
  }

  _add(moves, fromX, fromY, toX, toY, side) {
    const target = this.pieceAt(toX, toY);
    if (target === undefined) return false;
    if (target && pieceSide(target) === side) return false;
    moves.push({ from: [fromX, fromY], to: [toX, toY] });
    return !target; // 返回是否空格（可继续滑动）
  }

  _rookMoves(x, y, side, moves) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      let cx = x + dx, cy = y + dy;
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
        const cont = this._add(moves, x, y, cx, cy, side);
        if (!cont) break;
        cx += dx; cy += dy;
      }
    }
  }

  _cannonMoves(x, y, side, moves) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      let cx = x + dx, cy = y + dy;
      // 第一段：空地行走
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9 && !this.pieceAt(cx, cy)) {
        moves.push({ from: [x, y], to: [cx, cy] });
        cx += dx; cy += dy;
      }
      // 越过一个炮架后找第一个棋子
      if (cx < 0 || cx > 8 || cy < 0 || cy > 9) continue;
      cx += dx; cy += dy;
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 9) {
        const t = this.pieceAt(cx, cy);
        if (t) {
          if (pieceSide(t) !== side) moves.push({ from: [x, y], to: [cx, cy] });
          break;
        }
        cx += dx; cy += dy;
      }
    }
  }

  _knightMoves(x, y, side, moves) {
    // 马走日，蹩马腿
    const steps = [
      [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
      [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
    ];
    for (const [dx, dy, bx, by] of steps) {
      if (this.pieceAt(x + bx, y + by)) continue; // 蹩腿
      this._add(moves, x, y, x + dx, y + dy, side);
    }
  }

  _bishopMoves(x, y, side, moves) {
    // 象飞田，塞象眼；不过河
    const steps = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
    for (const [dx, dy] of steps) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx > 8 || ny < 0 || ny > 9) continue;
      // 不过河
      if (side === RED && ny < 5) continue;
      if (side === BLACK && ny > 4) continue;
      if (this.pieceAt(x + dx / 2, y + dy / 2)) continue; // 塞象眼
      this._add(moves, x, y, nx, ny, side);
    }
  }

  _advisorMoves(x, y, side, moves) {
    // 士走斜线，不出九宫
    const steps = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of steps) {
      const nx = x + dx, ny = y + dy;
      if (!this._inPalace(nx, ny, side)) continue;
      this._add(moves, x, y, nx, ny, side);
    }
  }

  _kingMoves(x, y, side, moves) {
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of steps) {
      const nx = x + dx, ny = y + dy;
      if (!this._inPalace(nx, ny, side)) continue;
      this._add(moves, x, y, nx, ny, side);
    }
  }

  _pawnMoves(x, y, side, moves) {
    // 兵/卒只能前进（红向上 y-1，黑向下 y+1），过河后可横走
    const forward = side === RED ? -1 : 1;
    this._add(moves, x, y, x, y + forward, side);
    const crossed = side === RED ? y <= 4 : y >= 5;
    if (crossed) {
      this._add(moves, x, y, x - 1, y, side);
      this._add(moves, x, y, x + 1, y, side);
    }
  }

  _inPalace(x, y, side) {
    if (x < 3 || x > 5) return false;
    if (side === RED) return y >= 7 && y <= 9;
    return y >= 0 && y <= 2;
  }

  /** 某方是否被将军 */
  isChecked(side) {
    const kingIdx = this.findKing(side);
    if (kingIdx < 0) return true; // 将没了，视为被将死
    const kx = kingIdx % 9, ky = (kingIdx / 9) | 0;
    const enemy = opposite(side);

    // 检查对方所有伪着法能否吃到将
    const enemyMoves = this.pseudoMoves(enemy);
    for (const m of enemyMoves) {
      if (m.to[0] === kx && m.to[1] === ky) return true;
    }

    // 将帅照面：同一列且中间无子
    const enemyKingIdx = this.findKing(enemy);
    if (enemyKingIdx >= 0) {
      const ex = enemyKingIdx % 9, ey = (enemyKingIdx / 9) | 0;
      if (ex === kx) {
        let blocked = false;
        const y0 = Math.min(ky, ey) + 1, y1 = Math.max(ky, ey);
        for (let yy = y0; yy < y1; yy++) {
          if (this.pieceAt(kx, yy)) { blocked = true; break; }
        }
        if (!blocked) return true;
      }
    }
    return false;
  }

  /** 生成合法着法（已过滤送将） */
  legalMoves(side = this.side) {
    // 将已被吃：无着可走
    if (this.findKing(side) < 0) return [];
    const result = [];
    for (const m of this.pseudoMoves(side)) {
      const saved = this._applyRaw(m);
      if (!this.isChecked(side)) result.push(m);
      this._undoRaw(m, saved);
    }
    return result;
  }

  _applyRaw(m) {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const captured = this.pieceAt(tx, ty);
    this.setPiece(tx, ty, this.pieceAt(fx, fy));
    this.setPiece(fx, fy, null);
    return captured;
  }

  _undoRaw(m, captured) {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    this.setPiece(fx, fy, this.pieceAt(tx, ty));
    this.setPiece(tx, ty, captured || null);
  }

  /** 执行一步棋，记录历史，切换走子方 */
  makeMove(m) {
    const [fx, fy] = m.from, [tx, ty] = m.to;
    const captured = this.pieceAt(tx, ty);
    this.history.push({ from: [fx, fy], to: [tx, ty], captured });
    this._applyRaw(m);
    this.side = opposite(this.side);
    // 记录新局面（用于重复局面判和）
    this.positionCounts.set(this.positionKey(), (this.positionCounts.get(this.positionKey()) || 0) + 1);
    return captured;
  }

  undo() {
    const h = this.history.pop();
    if (!h) return null;
    // 撤销前先把当前局面的计数减一
    const key = this.positionKey();
    const c = (this.positionCounts.get(key) || 1) - 1;
    if (c <= 0) this.positionCounts.delete(key); else this.positionCounts.set(key, c);
    // 直接按记录还原，不依赖 FEN（否则会清空 history）
    const [fx, fy] = h.from, [tx, ty] = h.to;
    this.setPiece(fx, fy, this.pieceAt(tx, ty));
    this.setPiece(tx, ty, h.captured || null);
    this.side = opposite(this.side);
    return { from: h.from, to: h.to };
  }

  /** 局面指纹：子力位置 + 走子方（不含历史） */
  positionKey() {
    let s = '';
    for (let i = 0; i < 90; i++) s += this.cells[i] || '.';
    return s + (this.side === BLACK ? 'b' : 'r');
  }

  /** 当前局面重复次数（含本次） */
  repetitionCount() {
    return this.positionCounts.get(this.positionKey()) || 1;
  }

  /** 是否绝杀/困毙/三次重复；返回 {over, winner, reason} */
  gameStatus() {
    const legal = this.legalMoves(this.side);
    if (legal.length === 0) {
      // 无子可动：被将死或困毙，均判负
      return {
        over: true,
        winner: opposite(this.side),
        reason: this.isChecked(this.side) ? '将死' : '困毙',
      };
    }
    // 三次重复局面：判和（长将、长捉等循环都按此处理）
    if (this.repetitionCount() >= 3) {
      return { over: true, winner: null, reason: '三次重复局面，判和' };
    }
    return { over: false };
  }

  /** 仅剩将帅的残局判断（长将判和用不上，简单和棋） */
  isInsufficientMaterial() {
    let count = 0;
    for (const p of this.cells) if (p) count++;
    return count <= 2;
  }
}

export { PIECE_CHARS, START_FEN };
