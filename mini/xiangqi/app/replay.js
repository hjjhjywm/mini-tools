/**
 * 棋局回顾模块
 * 负责：棋谱的存储、导入导出、逐步回放
 *
 * 棋谱格式（JSON）：
 * {
 *   id, title, date, mode, result,
 *   startFen,              // 起始局面
 *   moves: [{n, side, text, from:[x,y], to:[x,y], cap}]
 * }
 */

const STORAGE_KEY = 'xiangqi.replays.v1';
const MAX_RECORDS = 50;

/** 生成唯一 id */
function makeId() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 读取全部棋谱 */
export function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 覆盖保存全部棋谱 */
export function saveAll(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
    return true;
  } catch {
    return false;
  }
}

/** 新增一条棋谱（自动裁剪旧记录） */
/**
 * 判断两份棋谱是否"同一局"（起始局面 + 全部着法完全一致）
 * 用于防止重复保存。
 */
export function isSameGame(a, b) {
  if (!a || !b) return false;
  if ((a.startFen || '') !== (b.startFen || '')) return false;
  const am = a.moves || [];
  const bm = b.moves || [];
  if (am.length !== bm.length) return false;
  for (let i = 0; i < am.length; i++) {
    const x = am[i], y = bm[i];
    if (!x.from || !y.from) {
      if (x.text !== y.text) return false;
      continue;
    }
    if (x.from[0] !== y.from[0] || x.from[1] !== y.from[1]) return false;
    if (x.to[0] !== y.to[0] || x.to[1] !== y.to[1]) return false;
  }
  return true;
}

/**
 * 新增一条棋谱。
 * 若库里已存在同一局（起始局面与着法完全相同），则直接返回已有记录、不重复写入。
 * @returns {{ record: object, duplicated: boolean }}
 */
export function addGame(game) {
  const list = loadAll();
  const rec = {
    id: game.id || makeId(),
    title: game.title || '未命名对局',
    date: game.date || new Date().toISOString().slice(0, 16).replace('T', ' '),
    mode: game.mode || 'pve',
    result: game.result || '未分胜负',
    startFen: normalizeFen(game.startFen),
    moves: game.moves || [],
  };

  // 去重：同一局只保留一条
  const existing = list.find((g) => isSameGame(g, rec));
  if (existing) {
    return { record: existing, duplicated: true };
  }

  list.unshift(rec);
  saveAll(list);
  return { record: rec, duplicated: false };
}

/** 删除一条棋谱 */
export function removeGame(id) {
  const list = loadAll().filter((g) => g.id !== id);
  saveAll(list);
  return list;
}

/** 清空全部棋谱 */
export function clearAll() {
  saveAll([]);
  return [];
}

/** 导出为 JSON 字符串 */
export function toJson(game) {
  return JSON.stringify(game, null, 2);
}

const START_FEN_DEFAULT = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

/**
 * 校验并补全 FEN。
 * 导入的棋谱常常缺 startFen 或写成空串，直接拿去构造棋盘会崩溃，
 * 这里统一兜底成标准开局。
 */
export function normalizeFen(fen) {
  if (typeof fen !== 'string') return START_FEN_DEFAULT;
  const t = fen.trim();
  if (!t) return START_FEN_DEFAULT;
  const parts = t.split(/\s+/);
  if (parts.length < 1) return START_FEN_DEFAULT;
  const rows = parts[0].split('/');
  // 必须是 10 行
  if (rows.length !== 10) return START_FEN_DEFAULT;
  // 每行展开后必须正好 9 列
  for (const row of rows) {
    let cols = 0;
    for (const ch of row) {
      if (ch >= '0' && ch <= '9') cols += Number(ch);
      else cols += 1;
    }
    if (cols !== 9) return START_FEN_DEFAULT;
  }
  // 走子方必须是 r/b
  const side = (parts[1] || 'r').toLowerCase();
  return parts[0] + ' ' + (side === 'b' ? 'b' : 'r');
}

/**
 * 导入：支持自带格式 JSON，也支持简易文本棋谱
 * 简易文本示例："炮二平五 马8进7 马二进三"
 * 返回 {ok, game, error}
 */
export function fromImport(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: false, error: '内容为空' };

  // 先尝试 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed);
      const game = Array.isArray(obj) ? obj[0] : obj;
      if (!game || !Array.isArray(game.moves)) {
        return { ok: false, error: 'JSON 里没有 moves 数组' };
      }
      // 关键：补全 startFen，否则 Replayer 用 undefined 构造棋盘会直接崩溃
      return { ok: true, game: { ...game, startFen: normalizeFen(game.startFen), id: makeId() } };
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败：' + e.message };
    }
  }

  // 简易文本：把记谱拆成 move 列表；无法还原坐标时标记为仅记谱
  const tokens = trimmed.split(/[\s,，;；]+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: '没有识别到着法' };

  const moves = tokens.map((t, i) => ({
    n: Math.floor(i / 2) + 1,
    side: i % 2 === 0 ? 'r' : 'b',
    text: t,
    from: null,
    to: null,
  }));

  return {
    ok: true,
    game: {
      id: makeId(),
      title: '导入的棋谱',
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      mode: 'import',
      result: '未知',
      startFen: START_FEN_DEFAULT,
      moves,
    },
  };
}

/**
 * 播放器：在给定棋谱上逐步前进/后退
 * 用可重建的 Board 按 from/to 重放。无坐标的着法标记为"仅记谱，无法重放画面"。
 */
export class Replayer {
  constructor(game) {
    this.game = game;
    this.steps = game.moves || [];
    this.index = 0; // 已走的步数（0 = 初始局面）
    this.playable = this.steps.length > 0
      && this.steps.every((m) => Array.isArray(m.from) && Array.isArray(m.to));
  }

  get total() {
    return this.steps.length;
  }

  get current() {
    return this.index;
  }

  get atStart() {
    return this.index === 0;
  }

  get atEnd() {
    return this.index >= this.total;
  }

  /** 当前刚执行的那一步 */
  get currentStep() {
    return this.steps[this.index - 1] || null;
  }

  /** 当前这一步的说明文本 */
  get currentText() {
    const s = this.currentStep;
    if (!s) return '初始局面';
    const side = s.side === 'r' ? '红' : '黑';
    return `${s.n}. ${side} ${s.text}` + (s.cap ? ` 吃${s.cap}` : '');
  }

  /**
   * 从头重放前 n 步，返回棋盘
   * @param {(fen:string)=>any} BoardCtor 棋盘构造器（由调用方注入，避免循环依赖）
   */
  boardAt(n, BoardCtor) {
    // 兜底：即使 game.startFen 缺失/非法也不让回放崩掉
    const b = BoardCtor.fromFen(normalizeFen(this.game.startFen));
    const upto = Math.min(n, this.total);
    for (let i = 0; i < upto; i++) {
      const s = this.steps[i];
      if (!s.from || !s.to) break;
      b.makeMove({ from: s.from.slice(), to: s.to.slice() });
    }
    return b;
  }
}
