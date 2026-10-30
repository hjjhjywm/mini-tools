import { Board, RED, BLACK, PIECE_CHARS, pieceSide, opposite } from './engine.js';
import { chooseMove, evaluate, DIFFICULTIES } from './ai.js';
import { ENDGAMES } from './endgames.js';
import { loadAll, addGame, removeGame, fromImport, Replayer, toJson, normalizeFen } from './replay.js';
// 音效模块的函数名自带前缀，打包内联后与其它模块不冲突
import {
  playSound,
  unlockSound,
  setSoundVolume,
  setSoundMuted,
  isSoundMuted,
  loadSoundSettings,
} from './sound.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// 画布逻辑尺寸（9列×10行棋盘，含边距）
const MARGIN = 70;
const CELL = 88;
const W = 900, H = 1000;
canvas.width = W;
canvas.height = H;

const BOARD_W = CELL * 8;      // 棋盘线宽
const BOARD_H = CELL * 9;
const OX = MARGIN;
const OY = MARGIN;

// 坐标转换
const px = (x) => OX + x * CELL;
const py = (y) => OY + y * CELL;

// 游戏状态
const state = {
  board: new Board(),
  mode: 'pve',          // pve | pvp | endgame
  difficulty: 'normal',
  playerSide: RED,      // 玩家执红
  aiThinking: false,
  selected: null,       // {x,y}
  legalForSelected: [],
  lastMove: null,
  checkSide: null,
  gameOver: false,
  moveLog: [],
  anim: null,           // {fx,fy,tx,ty,piece,progress} 走子动画进行中
  animDone: null,       // 动画结束的 Promise
  endgame: null,        // 当前残局配置
  moveCount: 0,         // 本局已走步数（残局限步用）
  gameStartFen: null,   // 本局起始局面（保存棋谱用）
  moveRecords: [],      // 本局完整走子记录（保存棋谱用）
  replayer: null,       // 回顾模式的播放器
  replayTimer: null,    // 自动播放定时器
  savedForThisGame: false, // 本局是否已提示过保存
  gameSaved: false,      // 本局是否已实际保存过（防重复入库）
  savedGameId: null,     // 本局已保存记录的 id
  saveTipTimer: null,   // 结束提示条的自动收起定时器
};

// ---------- 绘图 ----------
function drawBoard() {
  // 木纹背景
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#d8b684');
  g.addColorStop(0.5, '#e8cfa6');
  g.addColorStop(1, '#c9a06a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 木纹纹理
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = i % 2 ? '#6b4423' : '#8a5a2b';
    ctx.lineWidth = Math.random() * 2 + 0.4;
    ctx.beginPath();
    const y0 = Math.random() * H;
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(W * .3, y0 + (Math.random() - .5) * 40, W * .7, y0 + (Math.random() - .5) * 40, W, y0 + (Math.random() - .5) * 30);
    ctx.stroke();
  }
  ctx.restore();

  // 外框
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(px(0) - 12, py(0) - 12, BOARD_W + 24, BOARD_H + 24);
  ctx.lineWidth = 2;
  ctx.strokeRect(px(0), py(0), BOARD_W, BOARD_H);

  // 内部横线
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#5a3a1a';
  for (let y = 1; y < 9; y++) {
    ctx.beginPath();
    ctx.moveTo(px(0), py(y));
    ctx.lineTo(px(8), py(y));
    ctx.stroke();
  }

  // 竖线（楚河汉界处断开）
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) {
      ctx.beginPath();
      ctx.moveTo(px(x), py(0));
      ctx.lineTo(px(x), py(9));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(px(x), py(0));
      ctx.lineTo(px(x), py(4));
      ctx.moveTo(px(x), py(5));
      ctx.lineTo(px(x), py(9));
      ctx.stroke();
    }
  }

  // 九宫斜线
  drawPalace(3, 0, 5, 2);
  drawPalace(3, 7, 5, 9);

  // 炮位、兵位的十字标记
  const marks = [
    [1, 2], [7, 2], [1, 7], [7, 7],       // 炮位
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
  ];
  for (const [x, y] of marks) drawMark(x, y);

  // 楚河汉界
  ctx.fillStyle = '#6b4423';
  ctx.font = '600 40px "KaiTi", "STKaiti", "Microsoft YaHei", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.75;
  ctx.fillText('楚 河', px(2), py(4.5) );
  ctx.fillText('汉 界', px(6), py(4.5) );
  ctx.globalAlpha = 1;
}

function drawPalace(x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(px(x0), py(y0));
  ctx.lineTo(px(x1), py(y1));
  ctx.moveTo(px(x1), py(y0));
  ctx.lineTo(px(x0), py(y1));
  ctx.stroke();
}

function drawMark(x, y) {
  const d = 7, gap = 5;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = px(x) + sx * gap;
    const cy = py(y) + sy * gap;
    ctx.moveTo(cx, cy - sy * d * -1);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * d, cy);
  }
  ctx.stroke();
}

function drawPieces() {
  const b = state.board;
  const anim = state.anim;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = b.pieceAt(x, y);
      if (!p) continue;
      // 动画期间：终点那枚棋子先不画（由动画单独绘制在移动路径上）
      if (anim && x === anim.tx && y === anim.ty) continue;
      drawPiece(x, y, p);
    }
  }
}

function drawPiece(x, y, p) {
  drawPieceAt(x, y, p, 1);
}

/**
 * 在任意位置绘制棋子。x/y 可为小数（动画用），scale 用于轻微缩放。
 */
function drawPieceAt(x, y, p, scale = 1) {
  const cx = px(x), cy = py(y);
  const r = CELL * 0.42 * scale;
  const isRed = pieceSide(p) === RED;

  // 阴影
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx + 2, cy + 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40,20,5,.28)';
  ctx.fill();
  ctx.restore();

  // 棋子底
  const grd = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r);
  if (isRed) {
    grd.addColorStop(0, '#fff3e0');
    grd.addColorStop(1, '#f0d9b5');
  } else {
    grd.addColorStop(0, '#fdfaf4');
    grd.addColorStop(1, '#e8ddc8');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // 外圈
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = isRed ? '#b02020' : '#1a1a1a';
  ctx.stroke();

  // 内圈
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 文字
  ctx.fillStyle = isRed ? '#b02020' : '#1a1a1a';
  ctx.font = `600 ${Math.round(r * 1.15)}px "KaiTi", "STKaiti", "Microsoft YaHei", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PIECE_CHARS[p], cx, cy + 1);
}

function drawHighlights() {
  const b = state.board;

  // 上一步走法
  if (state.lastMove) {
    const { from, to } = state.lastMove;
    for (const [x, y] of [from, to]) {
      ctx.beginPath();
      ctx.arc(px(x), py(y), CELL * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214, 160, 84, .28)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,160,84,.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // 选中
  if (state.selected) {
    const { x, y } = state.selected;
    ctx.beginPath();
    ctx.arc(px(x), py(y), CELL * 0.46, 0, Math.PI * 2);
    ctx.strokeStyle = '#2e8b57';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 可走点
    for (const m of state.legalForSelected) {
      const [tx, ty] = m.to;
      const target = b.pieceAt(tx, ty);
      ctx.beginPath();
      if (target) {
        ctx.arc(px(tx), py(ty), CELL * 0.46, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 40, 40, .85)';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else {
        ctx.arc(px(tx), py(ty), CELL * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(46, 139, 87, .75)';
        ctx.fill();
      }
    }
  }

  // 被将军的将/帅
  if (state.checkSide) {
    const idx = b.findKing(state.checkSide);
    if (idx >= 0) {
      const x = idx % 9, y = (idx / 9) | 0;
      ctx.beginPath();
      ctx.arc(px(x), py(y), CELL * 0.48, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 60, 40, .95)';
      ctx.lineWidth = 5;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  drawBoard();
  drawHighlights();
  drawPieces();
  // 动画中的棋子画在最上层
  if (state.anim) drawAnimPiece();
  updateSideUI();
}

// ---------- 走子动画 ----------
let ANIM_MS = 260; // 单步移动时长，可在界面上切换（快/适中/慢）

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 启动一次走子动画。棋盘数据此时已经更新完毕，
 * 这里只是把「移动的那枚棋子」额外从起点画到终点。
 */
function startMoveAnim(move, piece) {
  return new Promise((resolve) => {
    const [fx, fy] = move.from;
    const [tx, ty] = move.to;
    const t0 = performance.now();
    const token = {};

    state.anim = { fx, fy, tx, ty, piece, progress: 0, token };

    function step(now) {
      // 动画被取消（悔棋/重新开局）时直接结束，不再绘制
      if (state.anim !== null && state.anim.token !== token) {
        resolve();
        return;
      }
      if (state.anim === null) {
        resolve();
        return;
      }
      const p = Math.min(1, (now - t0) / ANIM_MS);
      state.anim.progress = easeInOut(p);
      render();
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        state.anim = null;
        render();
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

function drawAnimPiece() {
  const a = state.anim;
  if (!a || !a.piece) return;
  const x = a.fx + (a.tx - a.fx) * a.progress;
  const y = a.fy + (a.ty - a.fy) * a.progress;
  drawPieceAt(x, y, a.piece, 1 + 0.06 * Math.sin(Math.PI * a.progress));
}

// ---------- UI 更新 ----------
function updateSideUI() {
  const b = state.board;
  const sideText = b.side === RED ? '红方' : '黑方';
  document.getElementById('turnText').textContent = sideText + '走棋';
  const dot = document.querySelector('#turnBadge .dot');
  dot.className = 'dot ' + (b.side === RED ? 'red' : 'black');

  document.getElementById('checkWarn').hidden = !state.checkSide;

  let statusText;
  if (state.mode === 'endgame' && state.endgame) {
    const remain = state.endgame.goal.maxMoves - state.moveCount;
    statusText = `残局：${state.endgame.name} · 剩余 ${remain} 步`;
  } else if (state.mode === 'pve') {
    statusText = `人机 · ${b.side === RED ? '红' : '黑'}方该走（你执${state.playerSide === RED ? '红' : '黑'}）`;
  } else {
    statusText = `双人 · ${b.side === RED ? '红' : '黑'}方该走`;
  }
  document.getElementById('statusLine').textContent = statusText;
}

function renderMoveLog() {
  const el = document.getElementById('moveList');
  el.innerHTML = state.moveLog.map((entry, i) => {
    const moveNo = Math.floor(i / 2) + 1;
    const isRedMove = i % 2 === 0;
    return `<div class="mv"><span class="no">${isRedMove ? moveNo + '.' : ''}</span>` +
      `<span class="${isRedMove ? 'red-mv' : 'black-mv'}">${entry.text}</span></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// 中文记谱：车九进一 之类
const COL_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function moveToChinese(boardBefore, m) {
  const p = boardBefore.pieceAt(m.from[0], m.from[1]);
  if (!p) return '?';
  const isRed = pieceSide(p) === RED;
  const char = PIECE_CHARS[p];
  // 红方从右往左数 1-9，黑方从左往右
  const fileOf = (x) => isRed ? 9 - x : x + 1;
  const fromFile = COL_CN[fileOf(m.from[0])];
  const toFile = COL_CN[fileOf(m.to[0])];
  const dirWord = isRed ? (m.to[1] < m.from[1] ? '进' : '退') : (m.to[1] > m.from[1] ? '进' : '退');
  const sameFile = m.from[0] === m.to[0];
  let toWord;
  if (sameFile) {
    toWord = COL_CN[Math.abs(m.to[1] - m.from[1])];
  } else {
    toWord = toFile;
  }
  if (sameFile && m.to[1] === m.from[1]) {
    // 横向移动
    return char + fromFile + (m.to[0] > m.from[0] ? '平' : '平') + toFile;
  }
  if (!sameFile && m.to[1] === m.from[1]) {
    return char + fromFile + '平' + toFile;
  }
  return char + fromFile + dirWord + toWord;
}

// ---------- 交互 ----------
function canvasCoord(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;
  // 找最近的交叉点
  const x = Math.round((mx - OX) / CELL);
  const y = Math.round((my - OY) / CELL);
  if (x < 0 || x > 8 || y < 0 || y > 9) return null;
  // 距离太远不算
  const dx = mx - px(x), dy = my - py(y);
  if (Math.hypot(dx, dy) > CELL * 0.5) return null;
  return { x, y };
}

function myTurn() {
  if (state.gameOver) return false;
  if (state.mode === 'pvp') return true;
  return state.board.side === state.playerSide;
}

function onClick(evt) {
  // 回顾模式下棋盘只读
  if (state.mode === 'replay') return;
  // 动画播放中不接受新的点击，避免和动画抢画面
  if (state.anim) return;
  if (state.aiThinking || !myTurn()) return;
  const pos = canvasCoord(evt);
  if (!pos) return;
  const b = state.board;
  const { x, y } = pos;
  const p = b.pieceAt(x, y);

  // 已选中，检查是否点击合法目标
  if (state.selected) {
    const target = state.legalForSelected.find(m => m.to[0] === x && m.to[1] === y);
    if (target) {
      performMove(target);
      return;
    }
  }

  // 点自己的子
  if (p && pieceSide(p) === b.side) {
    state.selected = { x, y };
    state.legalForSelected = b.legalMoves(b.side).filter(m => m.from[0] === x && m.from[1] === y);
    render();
    return;
  }

  // 点空或对方子：取消选中
  state.selected = null;
  state.legalForSelected = [];
  render();
}

function performMove(move) {
  // 回顾模式下棋盘只读：防止残留的 AI 回调往回顾局面上落子
  if (state.mode === 'replay') return;
  const b = state.board;
  const text = moveToChinese(b, move);
  const mover = b.side;
  const movingPiece = b.pieceAt(move.from[0], move.from[1]);

  // 先记下信息，立刻走棋（数据即时更新），绘制时用动画把棋子画在移动路径上
  state.selected = null;
  state.legalForSelected = [];
  const captured = b.makeMove(move);
  state.lastMove = { from: move.from, to: move.to };
  state.checkSide = b.isChecked(b.side) ? b.side : null;
  state.moveLog.push({ text, side: mover, captured });
  // 记录完整走子信息，供保存棋谱用
  state.moveRecords.push({
    n: Math.floor(state.moveRecords.length / 2) + 1,
    side: mover === RED ? 'r' : 'b',
    text,
    from: move.from.slice(),
    to: move.to.slice(),
    cap: captured ? PIECE_CHARS[captured] : null,
  });
  state.moveCount++;
  renderMoveLog();
  render();

  // 音效：吃子比落子更重；将军另外补一声警示
  playSound(captured ? 'capture' : 'move');
  if (state.checkSide) {
    setTimeout(() => playSound('check'), 140);
  }

  // 播放移动动画，动画结束后再判定终局 / 轮到 AI
  state.animDone = startMoveAnim(move, movingPiece).then(() => {
    if (state.gameOver) return;
    const st = b.gameStatus();
    if (st.over) {
      state.gameOver = true;
      setTimeout(() => showGameOver(st), 200);
      return;
    }
    // 残局：超出步数上限判失败
    if (state.mode === 'endgame' && state.endgame && state.moveCount >= state.endgame.goal.maxMoves) {
      state.gameOver = true;
      setTimeout(() => showGameOver({ over: true, winner: null, reason: '超出步数限制' }), 200);
      return;
    }
    if ((state.mode === 'pve' || state.mode === 'endgame') && b.side !== state.playerSide) {
      setTimeout(aiMove, 260);
    }
  });
}

function aiMove() {
  if (state.gameOver) return;
  if (state.mode === 'replay') return;
  state.aiThinking = true;
  document.getElementById('thinking').hidden = false;

  // 让 UI 先更新，再跑搜索
  setTimeout(() => {
    const t0 = performance.now();
    const res = chooseMove(state.board, state.difficulty);
    const dt = Math.round(performance.now() - t0);

    // 低难度搜索很快，加个最低思考时间，避免"瞬间落子"显得太生硬
    const MIN_THINK_MS = 450;
    const wait = Math.max(0, MIN_THINK_MS - dt);

    setTimeout(() => {
      // 思考期间用户可能切走了模式（比如进了回顾），此时必须放弃这步棋
      if (state.mode === 'replay' || state.gameOver) return;
      state.aiThinking = false;
      document.getElementById('thinking').hidden = true;

      if (!res || !res.move) {
        document.getElementById('aiMeta').textContent = '电脑无着可走';
        return;
      }
      document.getElementById('aiMeta').textContent =
        `深度 ${res.depth} · 节点 ${res.nodes} · ${dt}ms`;

      performMove(res.move);
    }, wait);
  }, 30);
}

function showGameOver(st) {
  const overlay = document.getElementById('overlay');
  let title, sub;

  if (state.mode === 'endgame') {
    // 残局：玩家执红，红方赢=通关
    if (st.winner === RED) {
      title = '通关成功';
      sub = `${state.endgame.name} · 用 ${state.moveCount} 步完成`;
    } else if (st.winner === BLACK) {
      title = '挑战失败';
      sub = `${state.endgame.name} · 被黑方反杀（${st.reason}）`;
    } else {
      title = '挑战失败';
      sub = `${state.endgame.name} · ${st.reason}`;
    }
  } else {
    title = st.winner === RED ? '红方胜' : st.winner === BLACK ? '黑方胜' : '和棋';
    sub = st.reason || '';
    if (state.mode === 'pve') {
      sub += st.winner === state.playerSide ? ' · 你赢了！' : ' · 电脑获胜';
    }
  }

  document.getElementById('ovTitle').textContent = title;
  document.getElementById('ovText').textContent = sub;
  overlay.hidden = false;

  // 胜负音效：站在玩家视角判断输赢（残局执红、人机按所选执子、双人按下棋方）
  playResultSound(st);

  // 对局结束 → 提示是否保存到棋局回顾
  promptSaveAfterGame(st, title);
}

/** 按"玩家视角"播放结算音效 */
function playResultSound(st) {
  if (!st.winner) {
    playSound('draw');
    return;
  }
  if (state.mode === 'pvp') {
    // 双人不分你我，只给一个中性的结束音
    playSound('draw');
    return;
  }
  const playerWon = st.winner === state.playerSide;
  playSound(playerWon ? 'win' : 'lose');
}

/**
 * 一局结束后询问是否保存棋谱。
 * 用弹层里内置的按钮而不是 window.confirm，避免被浏览器拦截、也更顺手。
 */
function promptSaveAfterGame(st, resultText) {
  // 残局/已保存过的不再重复问
  if (state.moveRecords.length === 0) return;
  if (state.savedForThisGame) return;
  state.savedForThisGame = true;

  const bar = document.getElementById('saveTip');
  if (!bar) return;
  bar.hidden = false;
  document.getElementById('saveTipText').textContent =
    `对局结束（${resultText}），要把这局 ${state.moveRecords.length} 步存进「棋局回顾」吗？`;
  // 自动消失保护：30 秒后收起
  clearTimeout(state.saveTipTimer);
  state.saveTipTimer = setTimeout(() => { bar.hidden = true; }, 30000);
}

/** 由当前棋盘状态推导胜负结果（统一口径：红胜/黑胜/和棋/未分胜负） */
function computeResult() {
  const st = state.board.gameStatus();
  if (st.over) {
    if (st.winner === RED) return '红胜';
    if (st.winner === BLACK) return '黑胜';
    return '和棋';
  }
  return '未分胜负';
}

/** 生成棋谱标题 */
function makeGameTitle(result, displayTitle) {
  if (state.mode === 'endgame' && state.endgame) {
    return `残局「${state.endgame.name}」· ${displayTitle || result}`;
  }
  const modeLabel = state.mode === 'pvp' ? '双人' : '人机';
  return `${modeLabel}对局 · ${result}`;
}

/**
 * 保存当前已结束的对局（幂等：同一局只存一次）
 * 结束提示条的「保存」和结算浮层的「回顾这局」都走这里，
 * 所以必须保证重复调用不会写入两条。
 * @param {string} [displayTitle] 结算浮层上的展示标题（如「通关成功」），仅用于标题
 * @returns {{ ok: boolean, record?: object, already?: boolean }}
 */
function saveEndedGame(displayTitle) {
  if (state.moveRecords.length === 0) return { ok: false };

  // 本局已经存过了：直接返回那条记录，不再新增
  if (state.gameSaved && state.savedGameId) {
    const existing = loadAll().find((g) => g.id === state.savedGameId);
    if (existing) return { ok: true, record: existing, already: true };
  }

  const result = computeResult();
  const { record, duplicated } = addGame({
    title: makeGameTitle(result, displayTitle),
    mode: state.mode,
    result,
    startFen: state.gameStartFen || new Board().toFen(),
    moves: state.moveRecords.slice(),
  });

  state.gameSaved = true;
  state.savedGameId = record.id;
  renderReplayList();
  return { ok: true, record, already: duplicated };
}

function newGame() {
  // 回顾模式不重开对局
  if (state.mode === 'replay') return;

  playSound('ui');

  // 残局模式：载入残局局面；玩家固定执红
  if (state.mode === 'endgame' && state.endgame) {
    state.board = Board.fromFen(state.endgame.fen);
    state.playerSide = RED;
  } else {
    state.board = new Board();
  }

  state.gameStartFen = state.board.toFen();
  state.savedForThisGame = false;
  state.gameSaved = false;
  state.savedGameId = null;
  state.moveRecords = [];
  state.selected = null;
  state.legalForSelected = [];
  state.lastMove = null;
  state.checkSide = null;
  state.gameOver = false;
  state.moveLog = [];
  state.moveCount = 0;
  state.aiThinking = false;
  state.anim = null;
  state.animDone = null;
  document.getElementById('overlay').hidden = true;
  document.getElementById('thinking').hidden = true;
  document.getElementById('aiMeta').textContent = '—';
  render();
  renderMoveLog();

  // 人机模式执黑；残局玩家执红先手
  if (state.mode === 'pve' && state.playerSide !== RED) {
    setTimeout(aiMove, 300);
  }
}

function undo() {
  if (state.aiThinking || state.anim) return;
  if (state.mode === 'replay') return;
  const b = state.board;
  if (b.history.length === 0) return;

  playSound('ui');

  const isAI = state.mode === 'pve' || state.mode === 'endgame';

  // 人机/残局模式：撤销两步（电脑+自己）
  b.undo();
  state.moveCount = Math.max(0, state.moveCount - 1);
  if (isAI && b.history.length > 0 && b.side !== state.playerSide) {
    b.undo();
    state.moveCount = Math.max(0, state.moveCount - 1);
  }
  state.moveLog.pop();
  if (isAI && state.moveLog.length > 0) state.moveLog.pop();

  state.gameOver = false;
  state.selected = null;
  state.legalForSelected = [];
  state.lastMove = null;
  state.checkSide = b.isChecked(b.side) ? b.side : null;
  document.getElementById('overlay').hidden = true;

  render();
  renderMoveLog();
}

// ---------- 事件绑定 ----------
canvas.addEventListener('click', onClick);

document.getElementById('btnNew').addEventListener('click', newGame);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('ovNew').addEventListener('click', () => {
  document.getElementById('saveTip').hidden = true;
  newGame();
});

// 「回顾这局」：保存（若已存过则复用）并直接进入回顾模式播放
document.getElementById('ovReview').addEventListener('click', () => {
  const res = saveEndedGame(document.getElementById('ovTitle').textContent);
  document.getElementById('saveTip').hidden = true;
  clearTimeout(state.saveTipTimer);
  if (!res.ok || !res.record) return;
  document.getElementById('overlay').hidden = true;
  switchToMode('replay');
  renderReplayList();
  loadReplay(res.record);
});

// 结束提示条的保存/忽略
document.getElementById('btnSaveYes').addEventListener('click', () => {
  const res = saveEndedGame(document.getElementById('ovTitle').textContent);
  document.getElementById('saveTip').hidden = true;
  clearTimeout(state.saveTipTimer);
  if (res.ok) {
    document.getElementById('saveTipText').textContent = res.already
      ? '这局已经在棋局回顾里了'
      : '已保存到棋局回顾';
  }
});
document.getElementById('btnSaveNo').addEventListener('click', () => {
  document.getElementById('saveTip').hidden = true;
  clearTimeout(state.saveTipTimer);
});

/** 切换对局模式（点击按钮或用代码调用都走这里） */
function switchToMode(mode) {
  stopReplayAuto();
  const prevMode = state.mode;
  state.mode = mode;

  // 切模式时清掉所有"进行中"的异步状态：
  // 残留的 anim 会让 drawPieces 跳过某个格子的棋子（表现为"贴图消失"），
  // 残留的 AI 思考回调甚至会往回顾棋盘上落子。
  state.anim = null;
  state.animDone = null;
  state.aiThinking = false;
  document.getElementById('thinking').hidden = true;

  // 同步模式按钮的高亮
  const btns = document.querySelectorAll('#modeGroup button');
  btns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

  const isPve = mode === 'pve';
  const isEndgame = mode === 'endgame';
  const isReplay = mode === 'replay';
  document.getElementById('difficultyGroup').style.display = isPve ? '' : 'none';
  document.getElementById('colorGroup').style.display = isPve ? '' : 'none';
  document.getElementById('endgameGroup').hidden = !isEndgame;
  document.getElementById('replayGroup').hidden = !isReplay;
  document.getElementById('saveTip').hidden = true;

  // 离开回顾模式时，恢复棋盘为可玩状态
  if (prevMode === 'replay' && !isReplay) {
    state.replayer = null;
    document.getElementById('replayControls').hidden = true;
    newGame();
    return;
  }

  if (isReplay) {
    renderReplayList();
    // 进入回顾模式时先清空棋盘显示，等用户选一局
    state.board = new Board();
    state.lastMove = null;
    state.checkSide = null;
    state.selected = null;
    state.legalForSelected = [];
    state.gameOver = true; // 禁用交互
    render();
    renderMoveLog();
    return;
  }

  // 切到残局时，默认选中第一关
  if (isEndgame && !state.endgame) {
    state.endgame = ENDGAMES[0];
    renderEndgameList();
    showEndgameInfo(ENDGAMES[0]);
  }
  newGame();
}

document.getElementById('modeGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  switchToMode(btn.dataset.mode);
});

// ---------- 残局列表 ----------
function renderEndgameList() {
  const list = document.getElementById('endgameList');
  list.innerHTML = '';
  for (const eg of ENDGAMES) {
    const btn = document.createElement('button');
    btn.className = 'eg-item' + (state.endgame && state.endgame.id === eg.id ? ' active' : '');
    btn.dataset.id = eg.id;
    btn.innerHTML = `<span>${eg.name}</span><span class="eg-level">${eg.level}</span>`;
    list.appendChild(btn);
  }
}

function showEndgameInfo(eg) {
  document.getElementById('endgameInfo').hidden = false;
  document.getElementById('egName').textContent = eg.name;
  document.getElementById('egDesc').textContent = eg.desc;
  const hintEl = document.getElementById('egHint');
  hintEl.textContent = eg.hint;
  hintEl.hidden = true;
  document.getElementById('btnHint').textContent = '看提示';
}

document.getElementById('endgameList').addEventListener('click', (e) => {
  const btn = e.target.closest('.eg-item');
  if (!btn) return;
  const eg = ENDGAMES.find(x => x.id === btn.dataset.id);
  if (!eg) return;
  state.endgame = eg;
  renderEndgameList();
  showEndgameInfo(eg);
  newGame();
});

document.getElementById('btnHint').addEventListener('click', () => {
  const hintEl = document.getElementById('egHint');
  hintEl.hidden = !hintEl.hidden;
  document.getElementById('btnHint').textContent = hintEl.hidden ? '看提示' : '收起提示';
});

// ---------- 棋局回顾 ----------
function fmtDate(s) {
  return (s || '').replace('T', ' ').slice(0, 16);
}

function renderReplayList() {
  const list = document.getElementById('replayList');
  const games = loadAll();
  list.innerHTML = '';
  if (games.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'replay-empty';
    empty.textContent = '还没有保存的棋局。下完一局后点「保存本局」。';
    list.appendChild(empty);
    return;
  }
  for (const g of games) {
    const btn = document.createElement('button');
    const active = state.replayer && state.replayer.game.id === g.id;
    btn.className = 'eg-item' + (active ? ' active' : '');
    btn.dataset.id = g.id;
    btn.innerHTML = `<span>${g.title || '未命名'}<br><small>${fmtDate(g.date)} · ${g.moves.length}步</small></span>` +
      `<span class="eg-level">${g.result || '—'}</span>`;
    list.appendChild(btn);
  }
}

/** 载入一局进入回顾 */
function loadReplay(game) {
  stopReplayAuto();
  state.replayer = new Replayer(game);
  state.gameOver = true; // 回顾时禁止走子
  document.getElementById('replayControls').hidden = false;
  document.getElementById('replayTitle').textContent = game.title || '未命名对局';

  // 标注起始局面类型：残局开局只有几个子，不说明会被误当成"棋子没画出来"
  const startBoard = Board.fromFen(normalizeFen(game.startFen));
  const startPieces = startBoard.cells.filter(Boolean).length;
  const isFullBoard = startPieces >= 32;
  const modeLabel = game.mode === 'endgame' ? '残局' : (game.mode === 'pvp' ? '双人' : '人机');
  const startLabel = isFullBoard ? '满盘开局' : `残局开局（${startPieces} 枚棋子）`;
  const infoEl = document.getElementById('replayStartInfo');
  if (infoEl) {
    infoEl.textContent = `${modeLabel} · ${startLabel}`;
    infoEl.hidden = false;
  }

  const slider = document.getElementById('replaySlider');
  slider.max = String(state.replayer.total);
  slider.value = '0';

  // 无坐标的棋谱只能看记谱，不能重放画面
  if (!state.replayer.playable) {
    document.getElementById('replayStep').textContent =
      '这份棋谱只有记谱文字，无法重放棋盘（导入时缺少坐标信息）';
    state.board = Board.fromFen(normalizeFen(game.startFen));
    render();
    return;
  }

  renderReplayFrame(0);
  renderReplayList();
}

/** 渲染到第 n 步 */
function renderReplayFrame(n) {
  const rp = state.replayer;
  if (!rp || !rp.playable) return;
  const idx = Math.max(0, Math.min(n, rp.total));
  rp.index = idx;

  // 回顾是"摆局面"，绝不能带任何走子动画残留：
  // drawPieces 会跳过 anim.tx/anim.ty 那一格，残留 anim 会让该格棋子不显示
  state.anim = null;
  state.animDone = null;
  state.aiThinking = false;

  state.board = rp.boardAt(idx, Board);
  state.selected = null;
  state.legalForSelected = [];

  // 高亮最后一步
  const step = rp.steps[idx - 1];
  state.lastMove = step && step.from ? { from: step.from, to: step.to } : null;
  state.checkSide = state.board.isChecked(state.board.side) ? state.board.side : null;

  // 更新控件
  const slider = document.getElementById('replaySlider');
  slider.value = String(idx);
  document.getElementById('replayCount').textContent = `${idx} / ${rp.total}`;
  document.getElementById('replayStep').textContent = rp.currentText;

  // 同步左侧对局记录列表
  state.moveLog = rp.steps.slice(0, idx).map((s) => ({
    text: s.text,
    side: s.side === 'r' ? RED : BLACK,
    captured: s.cap ? PIECE_CHARS[s.cap] : null,
  }));
  renderMoveLog();
  render();
}

function stopReplayAuto() {
  if (state.replayTimer) {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
    const btn = document.getElementById('btnPlay');
    if (btn) btn.textContent = '▶ 播放';
  }
}

function toggleReplayAuto() {
  const rp = state.replayer;
  if (!rp || !rp.playable) return;
  if (state.replayTimer) {
    stopReplayAuto();
    return;
  }
  if (rp.atEnd) renderReplayFrame(0);
  document.getElementById('btnPlay').textContent = '⏸ 暂停';
  state.replayTimer = setInterval(() => {
    if (!state.replayer || state.replayer.atEnd) {
      stopReplayAuto();
      return;
    }
    renderReplayFrame(state.replayer.index + 1);
  }, ANIM_MS);
}

/** 把当前对局保存为棋谱（手动保存按钮，同样幂等） */
function saveCurrentGame() {
  if (state.mode === 'replay') return;
  if (!state.moveRecords || state.moveRecords.length === 0) {
    alert('这一局还没有走过棋，暂时无法保存。');
    return;
  }

  if (state.gameSaved && state.savedGameId) {
    alert('这一局已经保存过了。');
    return;
  }

  const result = computeResult();
  const { record, duplicated } = addGame({
    title: makeGameTitle(result),
    mode: state.mode,
    result,
    startFen: state.gameStartFen || new Board().toFen(),
    moves: state.moveRecords.slice(),
  });
  state.gameSaved = true;
  state.savedGameId = record.id;
  renderReplayList();
  alert(duplicated ? '这局已经在棋局回顾里了。' : `已保存：${state.moveRecords.length} 步`);
}

document.getElementById('replayList').addEventListener('click', (e) => {
  const btn = e.target.closest('.eg-item');
  if (!btn) return;
  const game = loadAll().find((g) => g.id === btn.dataset.id);
  if (!game) return;
  loadReplay(game);
});

document.getElementById('btnDeleteGame').addEventListener('click', () => {
  const rp = state.replayer;
  if (!rp) return;
  if (!confirm(`确定删除「${rp.game.title}」吗？`)) return;
  removeGame(rp.game.id);
  state.replayer = null;
  document.getElementById('replayControls').hidden = true;
  document.getElementById('replayStep').textContent = '—';
  state.board = new Board();
  state.lastMove = null;
  state.checkSide = null;
  render();
  renderMoveLog();
  renderReplayList();
});

document.getElementById('replaySlider').addEventListener('input', (e) => {
  stopReplayAuto();
  renderReplayFrame(Number(e.target.value));
});

document.getElementById('btnFirst').addEventListener('click', () => {
  stopReplayAuto();
  renderReplayFrame(0);
});
document.getElementById('btnPrev').addEventListener('click', () => {
  stopReplayAuto();
  if (state.replayer) renderReplayFrame(state.replayer.index - 1);
});
document.getElementById('btnPlay').addEventListener('click', toggleReplayAuto);
document.getElementById('btnNext').addEventListener('click', () => {
  stopReplayAuto();
  if (state.replayer) renderReplayFrame(state.replayer.index + 1);
});
document.getElementById('btnLast').addEventListener('click', () => {
  stopReplayAuto();
  if (state.replayer) renderReplayFrame(state.replayer.total);
});

document.getElementById('btnSaveCur').addEventListener('click', saveCurrentGame);

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const res = fromImport(String(reader.result));
    if (!res.ok) {
      alert('导入失败：' + res.error);
      return;
    }
    const { record, duplicated } = addGame(res.game);
    renderReplayList();
    loadReplay(record);
    alert(duplicated
      ? '这份棋谱已经在回顾列表里了，直接打开。'
      : `导入成功：${res.game.moves.length} 步`);
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
});

document.getElementById('diffGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#diffGroup button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.difficulty = btn.dataset.diff;
});

document.getElementById('colorPick').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#colorPick button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.playerSide = btn.dataset.side;
  newGame();
});

document.getElementById('speedPick').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#speedPick button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ANIM_MS = Number(btn.dataset.speed) || 260;
});

// ---------- 音效：音量滑块 + 静音开关 ----------
function refreshSoundUI() {
  const s = loadSoundSettings();
  const slider = document.getElementById('volumeSlider');
  const val = document.getElementById('volumeVal');
  const muteBtn = document.getElementById('btnMute');
  if (slider) slider.value = String(Math.round(s.volume * 100));
  if (val) val.textContent = `${Math.round(s.volume * 100)}%`;
  if (muteBtn) {
    muteBtn.textContent = s.muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', s.muted);
  }
}

document.getElementById('volumeSlider').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  unlockSound();
  setSoundVolume(v);
  const val = document.getElementById('volumeVal');
  if (val) val.textContent = `${Math.round(v * 100)}%`;
  const muteBtn = document.getElementById('btnMute');
  if (muteBtn) {
    muteBtn.textContent = '🔊';
    muteBtn.classList.remove('muted');
  }
  // 拖动时即时试听落子声
  playSound('move');
});

document.getElementById('btnMute').addEventListener('click', () => {
  unlockSound();
  const nowMuted = !isSoundMuted();
  setSoundMuted(nowMuted);
  refreshSoundUI();
  if (!nowMuted) playSound('ui');
});

// 浏览器要求先有用户交互才能出声：首次点击任意位置时解锁
const unlockAudio = () => {
  unlockSound();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

refreshSoundUI();

// 键盘快捷键
window.addEventListener('keydown', (e) => {
  if (e.key === 'u' || e.key === 'U') undo();
  if (e.key === 'n' || e.key === 'N') newGame();
});

// 启动
renderEndgameList();
render();
renderMoveLog();
