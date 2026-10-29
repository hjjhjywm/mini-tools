/**
 * smoke.mjs —— gh-lens 端到端冒烟（node smoke.mjs）
 *
 * 真的把服务起起来，检查三件事：
 *   1. 静态资源与非法路径拦截
 *   2. 真实调用 GitHub 搜索（需要网络 + token）
 *   3. **上游挂掉时还能用旧缓存**（这是本程序的核心承诺）
 *
 * 第三项用一个指向上游「死端口」的实例来构造，不需要断网。
 * 会占用 8799 / 8800 两个端口，跑完自动关闭。
 *
 * 退出码：0 全过，1 有失败。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trendingQuery, shapeSearch } from './query.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE_PORT = Number(process.env.SMOKE_LIVE_PORT || 8799);
const DEAD_PORT = Number(process.env.SMOKE_DEAD_PORT || 8800);
const LIVE = 'http://127.0.0.1:' + LIVE_PORT;
const DEAD = 'http://127.0.0.1:' + DEAD_PORT;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
    env: {
      ...process.env,
      GHLENS_NO_OPEN: '1',
      GHLENS_PORT: String(port),
      ...extraEnv,
    },
    stdio: 'ignore', // 沙箱里不能捕获子进程输出（命名管道被禁）
  });
  return child;
}

async function waitUp(base, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + '/api/status');
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  return false;
}

async function gh(base, apiPath, force = false) {
  const url = base + '/api/gh?path=' + encodeURIComponent(apiPath) + (force ? '&force=1' : '');
  const r = await fetch(url);
  const j = await r.json().catch(() => ({ ok: false, error: 'not json' }));
  // httpStatus 是 HTTP 状态码；body 里也有个 status（上游状态码，网络失败时是 0），别混
  return { httpStatus: r.status, ...j };
}

/* 固定的查询串，保证两次运行命中同一条缓存 */
const SEARCH = trendingQuery({ nowMs: Date.UTC(2026, 9, 18, 3, 0, 0), days: 30, minStars: 20 });

const children = [];

/** 等子进程退出，返回退出码；超时返回 null。 */
function waitExit(child, ms = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const LOG_PATH = path.join(HERE, '.cache', 'smoke-server.log');
try {
  fs.rmSync(LOG_PATH, { force: true });
} catch {
  /* ignore */
}

try {
  /* ---------- 1. 正常实例 ---------- */
  console.log('== 1. 静态资源与服务状态 (:' + LIVE_PORT + ') ==');
  const live = startServer(LIVE_PORT, { GHLENS_LOG_FILE: LOG_PATH });
  children.push(live);
  const up = await waitUp(LIVE);
  check('服务起来了', up);
  if (!up) throw new Error('服务没起来，后面的检查没意义');

  const status = await (await fetch(LIVE + '/api/status')).json();
  check('token 已加载', status.token === true, status.tokenError);
  check('重试次数 >= 1', status.maxAttempts >= 1, status.maxAttempts);

  const indexHtml = await (await fetch(LIVE + '/')).text();
  check('首页是 gh-lens', indexHtml.includes('gh-lens'));
  check('首页引了 module 脚本', indexHtml.includes('type="module"'));

  const appJs = await (await fetch(LIVE + '/app.js')).text();
  check('app.js 含发现入口', appJs.includes('exploreBtn'));
  check('app.js 真的 import query.mjs', appJs.includes("from './query.mjs'"));

  // DOM 契约：app.js 里 $('x') 取的每个 id，必须在页面里存在，或由 app.js 自己渲染出来。
  // 这条能挡住「改了 HTML 的 id，忘了改 JS」这类只在浏览器里才炸的错误。
  const wantedIds = new Set([...appJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const pageIds = new Set([...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const appMadeIds = new Set([...appJs.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missingIds = [...wantedIds].filter((id) => !pageIds.has(id) && !appMadeIds.has(id));
  check('app.js 取的 id 都存在', missingIds.length === 0, missingIds);

  const queryRes = await fetch(LIVE + '/query.mjs');
  check('/query.mjs 可访问', queryRes.ok);
  check('/query.mjs 是 JS', String(queryRes.headers.get('content-type')).includes('javascript'), queryRes.headers.get('content-type'));
  check('/query.mjs 内容正确', (await queryRes.text()).includes('trendingQuery'));

  // 回归：页面引用的每个脚本/样式都必须能取到。
  // 这条针对的是真实事故——新增了 query.mjs 却没人登记路由，运行的旧进程返回 404，
  // 浏览器里 module import 失败，所有按钮静默失灵。
  const refs = [...new Set([...indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((p) => /\.(js|mjs|css)$/.test(p));
  check('页面至少引了一个脚本', refs.length > 0, refs);
  for (const p of refs) {
    const r = await fetch(LIVE + p);
    check('页面引用的资源可访问 ' + p, r.ok, r.status);
  }

  for (const m of appJs.matchAll(/from\s+'(\.\/[^']+)'/g)) {
    const p = '/' + m[1].slice(2);
    const r = await fetch(LIVE + p);
    check('app.js 的静态 import 可访问 ' + p, r.ok, r.status);
  }

  const notThere = await fetch(LIVE + '/nope.mjs');
  check('不存在的脚本返回 404', notThere.status === 404, notThere.status);
  const traversal = await fetch(LIVE + '/..%2fserver.mjs');
  check('路径穿越被拒', traversal.status === 404, traversal.status);
  const cacheFile = await fetch(LIVE + '/.cache/x.json');
  check('不暴露 .cache 目录', cacheFile.status === 404, cacheFile.status);

  const bad = await gh(LIVE, 'admin/users');
  check('非法路径被拒', bad.httpStatus === 400 && bad.ok === false, bad.httpStatus);

  /* ---------- 2. 真实搜索 + 缓存命中 ---------- */
  console.log('== 2. 真实搜索与缓存 (:' + LIVE_PORT + ') ==');
  const first = await gh(LIVE, SEARCH);
  check('搜索 ok', first.ok === true, first.error);
  const shaped = shapeSearch(first.body);
  check('有结果', shaped.items.length > 0, shaped.total);
  check('结果里有 owner/repo', shaped.items.some((x) => x.full_name.includes('/')));
  check('返回了配额信息', Number.isFinite(first.rate?.remaining), first.rate);
  check('来源是网络或新鲜缓存', ['network', 'cache-fresh'].includes(first.source), first.source);

  const again = await gh(LIVE, SEARCH);
  check('第二次走缓存', again.source === 'cache-fresh', again.source);
  check('缓存内容与第一次一致', shapeSearch(again.body).items.length === shaped.items.length);

  /* ---------- 3. 上游挂掉 → 旧缓存顶上 ---------- */
  console.log('== 3. 上游不可达时的缓存回退 (:' + DEAD_PORT + ') ==');
  const dead = startServer(DEAD_PORT, { GHLENS_API_BASE: 'http://127.0.0.1:9' });
  children.push(dead);
  const deadUp = await waitUp(DEAD);
  check('降级实例起来了', deadUp);
  if (deadUp) {
    const stale = await gh(DEAD, SEARCH, true); // force 强制走网络，网络必然失败
    check('上游挂了仍然 200', stale.ok === true, stale);
    check('来源标为旧缓存', stale.source === 'cache-stale', stale.source);
    check('仍然有数据', shapeSearch(stale.body).items.length > 0);
    check('带上了失败原因', typeof stale.error === 'string' && stale.error.length > 0, stale.error);

    const uncached = await gh(DEAD, 'repos/hjjhjywm/hello-world?x=smoke-uncached-' + Date.now(), true);
    check('没缓存的新路径返回失败', uncached.httpStatus === 502 && uncached.ok === false, uncached.httpStatus);
  }

  /* ---------- 4. 双击两次不报错 + 停止服务 ---------- */
  console.log('== 4. 重复启动与停止 (: 同端口) ==');
  const second = startServer(LIVE_PORT); // 同一个端口再起一个：应识别出「已在运行」并 exit 0
  children.push(second);
  const secondCode = await waitExit(second, 8000);
  check('重复启动会自己退出（不是报错）', secondCode === 0, secondCode);
  check('第二次启动没有影响原实例', (await fetch(LIVE + '/api/status')).ok === true);

  check('日志文件已写入', fs.existsSync(LOG_PATH) && fs.readFileSync(LOG_PATH, 'utf8').includes('已启动'), LOG_PATH);

  const wrongMethod = await fetch(LIVE + '/api/shutdown');
  check('/api/shutdown 只接受 POST', wrongMethod.status === 404, wrongMethod.status);

  const stopRes = await fetch(LIVE + '/api/shutdown', { method: 'POST' });
  const stopJson = await stopRes.json().catch(() => ({}));
  check('/api/shutdown 返回 200', stopRes.status === 200 && stopJson.ok === true, stopRes.status);
  const liveCode = await waitExit(live, 5000);
  check('服务真的退出了（退出码 0）', liveCode === 0, liveCode);
} catch (e) {
  fail++;
  console.log('  FAIL 冒烟过程中抛错: ' + e.message);
} finally {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
}

console.log('\n====================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
