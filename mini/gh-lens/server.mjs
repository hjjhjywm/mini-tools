/**
 * server.mjs —— gh-lens 本地服务：GitHub API 代理 + 磁盘缓存 + 重试。
 *
 * 只监听 127.0.0.1，token 只在服务端使用，不发给浏览器。
 *
 * 环境变量：
 *   GHLENS_PORT      端口，默认 8787
 *   GHLENS_TTL_MS    缓存新鲜期，默认 300000（5 分钟）；<=0 表示永不过期
 *   GHLENS_TIMEOUT   单次请求超时，默认 12000
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizePath,
  cacheKey,
  isFresh,
  backoffMs,
  retriableStatus,
  retriableError,
  describeError,
} from './core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '.cache');
const PORT = Number(process.env.GHLENS_PORT || 8787);
const TTL_MS = Number(process.env.GHLENS_TTL_MS ?? 300000);
const TIMEOUT_MS = Number(process.env.GHLENS_TIMEOUT || 12000);
const MAX_ATTEMPTS = 4;
/** 上游地址；可指向 GitHub Enterprise 或本地桩服务（测试用）。 */
const API_BASE = (process.env.GHLENS_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
/** token 凭据文件：默认读 DSH GitHub 连接插件的位置，可用 GHLENS_AUTH 覆盖。 */
const AUTH_FILE = process.env.GHLENS_AUTH || path.join(os.homedir(), '.dsh', '.dsh-github-connect', 'auth.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 日志文件（用 .vbs 无窗口启动时看不到控制台，就落盘） ---------- */
const LOG_FILE = process.env.GHLENS_LOG_FILE || '';
if (LOG_FILE) {
  try {
    ensureLogDir();
    const st = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
    if (st && st.size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {
    /* 落盘失败不影响服务 */
  }
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...parts) => {
      original(...parts);
      try {
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${level.toUpperCase()} ${parts.map(String).join(' ')}\n`);
      } catch {
        /* ignore */
      }
    };
  }
}

function ensureLogDir() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

/* ---------- token ---------- */
let TOKEN = null;
let TOKEN_ERROR = null;
try {
  TOKEN = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')).token || null;
  if (!TOKEN) TOKEN_ERROR = '凭据文件里没有 token';
} catch (e) {
  TOKEN_ERROR = '读不到凭据文件: ' + e.message;
}

const HEADERS = () => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'gh-lens',
  ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
});

/* ---------- 缓存 ---------- */
function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j.fetchedAt === 'number') return j;
  } catch {
    /* 缓存坏了就当没有 */
  }
  return null;
}

function writeCache(file, entry) {
  try {
    ensureCacheDir();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn('[gh-lens] 写缓存失败:', e.message);
  }
}

/* ---------- 网络 ---------- */

/** 从响应头取配额信息（搜索和普通的额度是分开算的）。 */
function rateOf(headers) {
  const remaining = headers?.get?.('x-ratelimit-remaining');
  if (remaining == null) return undefined;
  const limit = headers.get('x-ratelimit-limit');
  const resource = headers.get('x-ratelimit-resource');
  return {
    remaining: Number(remaining),
    limit: limit == null ? undefined : Number(limit),
    resource: resource || undefined,
  };
}

async function fetchOnce(apiPath) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + '/' + apiPath, {
      headers: HEADERS(),
      signal: ctl.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 4000) };
    }
    return { ok: res.ok, status: res.status, body, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的请求。返回 { ok, status, body, error } */
async function fetchWithRetry(apiPath) {
  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetchOnce(apiPath);
      if (r.ok) return r;

      lastStatus = r.status;
      const msg = r.body && typeof r.body === 'object' ? r.body.message : '';
      lastError = `HTTP ${r.status}${msg ? ': ' + msg : ''}`;

      if (retriableStatus(r.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, status: r.status, body: r.body, error: lastError };
    } catch (e) {
      lastError = describeError(e);
      const aborted = e.name === 'AbortError';
      if ((aborted || retriableError(e)) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, status: 0, body: null, error: lastError };
    }
  }
  return { ok: false, status: lastStatus, body: null, error: lastError || '重试耗尽' };
}

/* ---------- 取数（缓存优先） ---------- */
async function getJson(apiPath, { force = false } = {}) {
  const key = cacheKey(apiPath);
  const file = path.join(CACHE_DIR, key + '.json');
  const entry = readCache(file);
  const now = Date.now();

  if (!force && entry && isFresh(entry, now, TTL_MS)) {
    return { ok: true, status: entry.status, body: entry.body, source: 'cache-fresh', fetchedAt: entry.fetchedAt, ageMs: now - entry.fetchedAt, rate: entry.rate };
  }

  const r = await fetchWithRetry(apiPath);

  if (r.ok) {
    const fetchedAt = Date.now();
    const rate = rateOf(r.headers);
    writeCache(file, { path: apiPath, fetchedAt, status: r.status, body: r.body, rate });
    return { ok: true, status: r.status, body: r.body, source: 'network', fetchedAt, ageMs: 0, rate };
  }

  // 网络失败 → 有旧缓存就用旧的（这是"稳定"的关键）
  if (entry) {
    return {
      ok: true,
      status: entry.status,
      body: entry.body,
      source: 'cache-stale',
      fetchedAt: entry.fetchedAt,
      ageMs: now - entry.fetchedAt,
      error: r.error,
      rate: entry.rate,
    };
  }

  return { ok: false, status: r.status, body: r.body, error: r.error, source: 'none' };
}

/* ---------- 静态文件 ---------- */

/**
 * 静态资源按扩展名白名单动态解析，**不再维护路径表**。
 *
 * 之前的写法是一张固定的 `{ '/app.js': ... }` 表，后来新增 query.mjs 时忘了登记，
 * 正在运行的旧进程就返回 404，浏览器里 <script type="module"> 的 import 失败，
 * 整个页面一个按钮都不响应（而且没有任何报错提示）。白名单方式下新增文件不用改这里，
 * 也不用重启（例外：静态表本身属于进程启动时读的代码，改 server.mjs 仍需重启）。
 */
const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

/** 只接受本目录下的单层文件名：不许子目录、不许 ..、必须命中扩展名白名单。 */
const STATIC_NAME = /^[A-Za-z0-9._-]+\.(html|js|mjs|css|svg|png|ico)$/;

function resolveStatic(pathname) {
  const name = pathname === '/' ? 'index.html' : String(pathname).replace(/^\/+/, '');
  if (!STATIC_NAME.test(name) || name.includes('..')) return null;
  return name;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendStatic(res, rel, type) {
  try {
    const buf = fs.readFileSync(path.join(HERE, rel));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET') {
    const rel = resolveStatic(url.pathname);
    if (rel) {
      const type = STATIC_TYPES.get(path.extname(rel).toLowerCase()) || 'application/octet-stream';
      return sendStatic(res, rel, type);
    }
  }

  if (url.pathname === '/api/status') {
    let cacheCount = 0;
    try {
      cacheCount = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).length;
    } catch {}
    return sendJson(res, 200, {
      token: Boolean(TOKEN),
      tokenError: TOKEN_ERROR,
      ttlMs: TTL_MS,
      timeoutMs: TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
      cacheCount,
      cacheDir: CACHE_DIR,
    });
  }

  if (url.pathname === '/api/gh') {
    const raw = url.searchParams.get('path') || '';
    const clean = normalizePath(raw);
    if (!clean) return sendJson(res, 400, { ok: false, error: '非法路径：' + raw });

    const force = url.searchParams.get('force') === '1';
    const out = await getJson(clean, { force });
    return sendJson(res, out.ok ? 200 : 502, out);
  }

  if (url.pathname === '/api/prefetch' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return sendJson(res, 413, { ok: false, error: '请求体过大' });
    }
    let repo = '';
    try {
      repo = JSON.parse(body || '{}').repo || '';
    } catch {
      return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return sendJson(res, 400, { ok: false, error: 'repo 需为 owner/name' });

    const targets = [
      `repos/${repo}`,
      `repos/${repo}/readme`,
      `repos/${repo}/contents/`,
      `repos/${repo}/issues?state=all&per_page=30`,
      `repos/${repo}/pulls?state=all&per_page=30`,
      `repos/${repo}/commits?per_page=30`,
      `repos/${repo}/languages`,
    ];
    const results = [];
    for (const t of targets) {
      const r = await getJson(t, { force: true });
      results.push({ path: t, ok: r.ok, source: r.source || 'none', error: r.error });
    }
    return sendJson(res, 200, { ok: true, repo, results });
  }

  // 让页面上的「停止服务」按钮能干净地关掉这个后台进程（无窗口启动时尤其需要）
  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
    if (!loopback) return sendJson(res, 403, { ok: false, error: '只允许从本机停止服务' });
    sendJson(res, 200, { ok: true, stopping: true });
    setTimeout(() => {
      console.log('收到 /api/shutdown，正在退出。');
      process.exit(0);
    }, 120);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT;
  console.log('');
  console.log('  gh-lens 已启动');
  console.log('  ' + url);
  console.log('');
  console.log('  token      : ' + (TOKEN ? '已加载' : '缺失 — ' + TOKEN_ERROR));
  console.log('  上游       : ' + API_BASE);
  console.log('  缓存新鲜期 : ' + (TTL_MS > 0 ? Math.round(TTL_MS / 1000) + ' 秒' : '永不过期'));
  console.log('  缓存目录   : ' + CACHE_DIR);
  if (LOG_FILE) console.log('  日志文件   : ' + LOG_FILE);
  console.log('  停止：页面左下角「停止服务」，或 Ctrl+C');
  console.log('');

  if (process.platform === 'win32' && !process.env.GHLENS_NO_OPEN) {
    openBrowser(process.env.GHLENS_OPEN_URL || url);
  }
});

/**
 * 打开默认浏览器。用两种方式依次尝试，任一成功即可。
 * 失败不抛错——浏览器打不开不影响服务本身。
 */
function openBrowser(url) {
  const attempts = [
    ['cmd', ['/c', 'start', '', url]],
    ['rundll32', ['url.dll,FileProtocolHandler', url]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      console.log('  已请求打开浏览器（' + cmd + '）');
      return;
    } catch (e) {
      console.warn('  打开浏览器失败（' + cmd + '）: ' + e.message);
    }
  }
  console.warn('  无法自动打开浏览器，请手动访问上面的地址。');
}

server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') {
    console.error('启动失败: ' + e.message);
    process.exit(1);
  }

  // 端口被占：先看看占用者是不是「已经在跑的 gh-lens」。
  // 如果是，这不算错误 —— 直接打开浏览器，退出码 0，双击两次不会弹出报错。
  const base = 'http://127.0.0.1:' + PORT;
  const mine = await probeGhLens(base);
  if (mine) {
    console.log('');
    console.log('  gh-lens 已经在 ' + base + ' 跑了，不再重复启动。');
    if (process.platform === 'win32' && !process.env.GHLENS_NO_OPEN) openBrowser(base);
    console.log('  想关掉它：页面左下角「停止服务」，或结束占用该端口的 node 进程。');
    console.log('');
    process.exit(0);
  }

  console.error('');
  console.error('  端口 ' + PORT + ' 被别的程序占用了（不是 gh-lens）。');
  console.error('  换一个端口：set GHLENS_PORT=8788');
  console.error('');
  process.exit(1);
});

/** 探测 base 上跑的是不是 gh-lens（看 /api/status 的字段形状）。 */
async function probeGhLens(base) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(base + '/api/status', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const j = await res.json();
    return Boolean(j) && typeof j === 'object' && 'maxAttempts' in j && 'cacheDir' in j;
  } catch {
    return false;
  }
}
