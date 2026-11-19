/**
 * 教学模式：接入大模型 API，用自然语言讲解棋局
 *
 * 设计要点（降低延迟）：
 *   1. 流式输出（SSE）：第一个字 1-2 秒内出现，不用等整段生成
 *   2. 本地先算好局面摘要，让模型只负责"讲解"，不负责"算棋" —— token 少、延迟低
 *   3. 请求体最小化：只发关键信息（局面、候选着法、评估），不发完整棋谱
 *   4. 支持 OpenAI 兼容接口，用户自填 Key / BaseURL / 模型
 */

import { Board, RED, BLACK, PIECE_CHARS, pieceSide, opposite } from './engine.js';
import { searchBestMove, clearTT } from './ai.js';

const LS_KEY = 'xiangqi.teach.v1';

/** 读取本地配置 */
export function loadTeachConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultConfig();
    const o = JSON.parse(raw);
    return {
      enabled: !!o.enabled,
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      baseUrl: typeof o.baseUrl === 'string' && o.baseUrl ? o.baseUrl : defaultConfig().baseUrl,
      model: typeof o.model === 'string' && o.model ? o.model : defaultConfig().model,
      temperature: typeof o.temperature === 'number' ? o.temperature : 0.7,
    };
  } catch {
    return defaultConfig();
  }
}

export function defaultConfig() {
  return {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
  };
}

export function saveTeachConfig(cfg) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

/** 局面转成简洁文本（给模型看，尽量少 token） */
function boardToText(board) {
  const lines = [];
  for (let y = 0; y < 10; y++) {
    let row = '';
    for (let x = 0; x < 9; x++) {
      const p = board.pieceAt(x, y);
      row += p ? PIECE_CHARS[p] : '·';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

/** 列出双方子力 */
function materialText(board) {
  const count = (side) => {
    const m = {};
    for (const p of board.cells) {
      if (!p) continue;
      const isRed = p === p.toUpperCase();
      if ((isRed ? RED : BLACK) !== side) continue;
      const ch = PIECE_CHARS[p];
      m[ch] = (m[ch] || 0) + 1;
    }
    return Object.entries(m).map(([k, v]) => `${k}${v > 1 ? '×' + v : ''}`).join(' ');
  };
  return { red: count(RED), black: count(BLACK) };
}

/**
 * 构建给模型的局面摘要（本地算好，模型只负责讲解）
 */
export function buildSituation(board, hint) {
  const side = board.side === RED ? '红方' : '黑方';
  const mat = materialText(board);
  const inCheck = board.isChecked(board.side);

  let analysis = '';
  if (hint) {
    analysis = `引擎分析：推荐 ${hint.notation}，评估 ${hint.scoreText}。`;
    if (hint.reasons && hint.reasons.length) {
      analysis += `要点：${hint.reasons.join('；')}。`;
    }
  }

  return {
    side,
    boardText: boardToText(board),
    material: mat,
    inCheck,
    analysis,
  };
}

/** 构造 prompt —— 精简、直接，减少 token 和延迟 */
function buildPrompt(situation, question, style) {
  const styleGuide = {
    beginner: '用初学者能听懂的话讲，避免术语，多用比喻。',
    intermediate: '用有一定基础的棋友能懂的话讲，可以用基本术语。',
    advanced: '用专业棋理讲，可以深入分析。',
  }[style] || '用通俗易懂的话讲。';

  return `你是一位中国象棋教练。请${styleGuide}

当前局面（红方在下，黑方在上，·表示空位）：
${situation.boardText}

轮到：${situation.side}
红方子力：${situation.material.red}
黑方子力：${situation.material.black}
${situation.inCheck ? '当前被将军。' : ''}
${situation.analysis}

${question}

要求：
1. 直接回答，不要复述局面
2. 讲清楚"为什么"，而不只是"走哪里"
3. 控制在 200 字以内，分 2-3 个要点
4. 不要用 Markdown 标题和代码块`;
}

/**
 * 流式请求大模型
 * @param {object} cfg 配置
 * @param {string} prompt
 * @param {(chunk:string)=>void} onChunk 每收到一段文字就回调
 * @param {AbortSignal} signal 用于取消
 * @returns {Promise<string>} 完整文本
 */
export async function streamTeach(cfg, prompt, onChunk, signal) {
  if (!cfg.apiKey) throw new Error('还没填 API Key，请在设置里填写');

  const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是专业、耐心的中国象棋教练。' },
        { role: 'user', content: prompt },
      ],
      temperature: cfg.temperature,
      stream: true,
      max_tokens: 600,
    }),
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error?.message || JSON.stringify(j).slice(0, 200);
    } catch {
      detail = (await res.text()).slice(0, 200);
    }
    throw new Error(`API 返回 ${res.status}：${detail}`);
  }

  // 解析 SSE 流
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        /* 单行解析失败不影响整体 */
      }
    }
  }

  return full;
}

/**
 * 一键讲解当前局面（高层封装）
 */
export async function explainPosition(board, hint, opts = {}) {
  const cfg = loadTeachConfig();
  const situation = buildSituation(board, hint);
  const question = opts.question || '请分析当前局面，告诉我现在最该注意什么、下一步该往哪个方向走。';
  const prompt = buildPrompt(situation, question, opts.style || 'intermediate');
  return streamTeach(cfg, prompt, opts.onChunk || (() => {}), opts.signal);
}

/** 预设问题（降低用户输入成本） */
export const PRESET_QUESTIONS = [
  { id: 'next', label: '下一步怎么走', q: '我下一步该怎么走？为什么？' },
  { id: 'plan', label: '整体思路', q: '这个局面我该采取什么整体策略？进攻还是防守？重点在哪个区域？' },
  { id: 'danger', label: '我有什么危险', q: '我现在有什么潜在危险？对方可能有什么威胁我没注意到？' },
  { id: 'trap', label: '有没有陷阱', q: '当前局面有没有常见的陷阱或套路？我该怎么避免中招？' },
  { id: 'exchange', label: '该不该兑子', q: '现在适合兑子吗？兑子对谁有利？' },
];
