/**
 * core.mjs —— gh-lens 的纯逻辑层（不碰网络、不碰文件系统，可单测）。
 */

import crypto from 'node:crypto';
import { shapeRepo } from './query.mjs';

/** 只允许这些 GitHub API 前缀，避免被当成开放代理。 */
const ALLOWED_ROOTS = new Set([
  'repos',
  'user', // /user, /user/repos —— 当前登录用户
  'users', // /users/<login>
  'orgs',
  'search',
  'rate_limit',
  'gists',
  'notifications',
  'zen',
  'meta',
  'feeds',
]);

/**
 * 把用户输入规整成安全的 API 相对路径。
 * 接受："/repos/a/b"、"repos/a/b"、"https://api.github.com/repos/a/b?x=1"、"repos/a/b?x=1"
 * 返回：无前导斜杠、保留查询串的路径；不合法返回 null。
 */
export function normalizePath(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  // 去掉协议与主机
  s = s.replace(/^https?:\/\//i, '');
  if (s.startsWith('api.github.com/')) s = s.slice('api.github.com/'.length);
  else if (s.startsWith('api.github.com')) s = s.slice('api.github.com'.length);
  else if (s.includes('/') && s.includes('.')) {
    // 形如 "github.com/x" 这种别放行
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) return null;
  }

  s = s.replace(/^\/+/, '');
  if (!s) return null;

  // 拆查询串
  const qIndex = s.indexOf('?');
  const pathPart = qIndex === -1 ? s : s.slice(0, qIndex);
  const queryPart = qIndex === -1 ? '' : s.slice(qIndex + 1);

  // 禁止协议相对、反斜杠、上跳
  if (pathPart.includes('\\')) return null;
  if (pathPart.split('/').some((seg) => seg === '..' || seg === '.')) return null;

  const root = pathPart.split('/')[0];
  if (!ALLOWED_ROOTS.has(root)) return null;

  return queryPart ? `${pathPart}?${queryPart}` : pathPart;
}

/** 缓存键：路径的 sha256（查询串也参与，避免不同参数串味）。 */
export function cacheKey(path) {
  return crypto.createHash('sha256').update(String(path), 'utf8').digest('hex').slice(0, 32);
}

/** 缓存是否还新鲜。ttlMs <= 0 表示永不过期。 */
export function isFresh(entry, nowMs, ttlMs) {
  if (!entry || typeof entry.fetchedAt !== 'number') return false;
  if (!(ttlMs > 0)) return true;
  return nowMs - entry.fetchedAt < ttlMs;
}

/** 指数退避（含抖动），attempt 从 0 开始。 */
export function backoffMs(attempt, base = 300, cap = 4000) {
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  const jitter = raw * 0.2 * (Math.random() * 2 - 1);
  return Math.max(50, Math.round(raw + jitter));
}

/** 这些 HTTP 状态值得重试。 */
export function retriableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** 这些网络错误码值得重试。 */
const RETRIABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

export function retriableError(err) {
  if (!err) return false;
  let code = err.code || err.cause?.code;
  if (!code && err.cause?.errors?.length) code = err.cause.errors[0]?.code;
  return RETRIABLE_CODES.has(code);
}

/** 从错误里取一个可读的原因字符串。 */
export function describeError(err) {
  if (!err) return 'unknown';
  const code = err.code || err.cause?.code;
  const msg = err.message || err.cause?.message || String(err);
  return code && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

/** 人读的字节数。实现在 query.mjs（浏览器也要用），这里转导出，别让两处实现漂移。 */
export { humanSize } from './query.mjs';

/**
 * 把 GitHub 的「搜索/列表」响应裁成 UI 需要的字段，避免把几十 KB 塞给前端。
 * kind: 'repos' | 'issues' | 'commits' | 'releases' | 'files'
 */
export function shapeList(kind, data) {
  if (!Array.isArray(data)) return [];
  switch (kind) {
    case 'repos':
      // 整形逻辑在 query.mjs（浏览器也要用同一份）
      return data.map(shapeRepo).filter(Boolean);
    case 'issues':
      return data
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          user: i.user?.login,
          comments: i.comments,
          created_at: i.created_at,
          labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
          html_url: i.html_url,
        }));
    case 'pulls':
      return data.map((p) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        draft: p.draft,
        user: p.user?.login,
        merged_at: p.merged_at,
        created_at: p.created_at,
        html_url: p.html_url,
      }));
    case 'commits':
      return data.map((c) => ({
        sha: c.sha,
        short: String(c.sha).slice(0, 7),
        message: (c.commit?.message ?? '').split('\n')[0],
        author: c.commit?.author?.name,
        date: c.commit?.author?.date,
        html_url: c.html_url,
      }));
    case 'files':
      return data.map((f) => ({
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
      }));
    default:
      return data;
  }
}
