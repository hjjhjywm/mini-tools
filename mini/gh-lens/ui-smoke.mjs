/**
 * ui-smoke.mjs —— 用假 DOM 真的执行一遍 app.js，然后模拟点击「发现」。
 *
 * 为什么需要它：单元测试测的是纯函数，冒烟测的是服务端，两者都覆盖不到
 * 「app.js 在浏览器里根本没跑起来 / 点了没反应」这类问题 —— 而那正是真实
 * 出过的事故（旧的 server 进程不认新增的 /query.mjs，module import 404，
 * 整个页面的按钮全部静默失灵）。
 *
 * 这里塞一套最小 DOM，import app.js，然后点按钮、看它发出了什么请求、
 * 往页面上写了什么。不联网（fetch 是假的）。
 *
 * 退出码：0 全过，1 有失败。
 */

import { daysAgoDate } from './query.mjs';

const HERE = new URL('.', import.meta.url);
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

/* ---------- 最小 DOM ---------- */

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) this.set.add(c); else this.set.delete(c);
  }
  contains(c) { return this.set.has(c); }
}

/** 从一段 HTML 里抠出 chip / repo 链接的替身，用来模拟点击。 */
function stubsFor(html, sel) {
  const out = [];
  if (typeof html !== 'string' || !html) return out;
  const grab = (re, apply) => {
    for (const m of html.matchAll(re)) {
      const e = makeEl('button');
      apply(e, m);
      out.push(e);
    }
  };
  if (sel.includes('data-days')) grab(/class="chip[^"]*"\s+data-days="(\d+)"/g, (e, m) => { e.dataset.days = m[1]; });
  if (sel.includes('data-topic')) grab(/class="chip[^"]*"\s+data-topic="([^"]+)"/g, (e, m) => { e.dataset.topic = m[1]; });
  if (sel.includes('data-sort')) grab(/class="chip[^"]*"\s+data-sort="(\w+)"/g, (e, m) => { e.dataset.sort = m[1]; });
  if (sel.includes('data-repo')) grab(/data-repo="([^"]+)"/g, (e, m) => { e.dataset.repo = m[1]; });
  if (sel.includes('data-copy')) grab(/data-copy="([^"]+)"/g, (e, m) => { e.dataset.copy = m[1]; });
  if (sel.includes('data-snap')) grab(/data-snap="([^"]+)"/g, (e, m) => { e.dataset.snap = m[1]; });
  if (sel.includes('data-open-url')) grab(/data-open-url="([^"]+)"/g, (e, m) => { e.dataset.openUrl = m[1]; });
  if (sel.includes('.tab')) grab(/<button\s+data-tab="([a-z]+)"/g, (e, m) => { e.dataset.tab = m[1]; e.classList.add('tab'); });
  return out;
}

const els = new Map();

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id,
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    value: '',
    title: '',
    dataset: {},
    style: {},
    classList: new ClassList(),
    children: [],
    onclick: null,
    onkeydown: null,
    addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {},
    focus() {},
    querySelectorAll(sel) {
      this._stubs = this._stubs || {};
      if (!this._stubs[sel]) this._stubs[sel] = stubsFor(raw(this), sel);
      return this._stubs[sel];
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    closest(sel) {
      if (typeof sel === 'string' && sel.startsWith('.') && this.classList.contains(sel.slice(1))) return this;
      return null;
    },
  };

  let store = '';
  const raw = () => store;
  Object.defineProperty(el, 'innerHTML', {
    get: () => store,
    set: (v) => { store = String(v ?? ''); el._stubs = {}; },
  });
  return el;
}

globalThis.window = globalThis;
globalThis.document = {
  getElementById(id) {
    if (!els.has(id)) els.set(id, makeEl('div', id));
    return els.get(id);
  },
  createElement(tag) { return makeEl(tag); },
  querySelectorAll() { return []; },
};

/* 剪贴板替身（复制按钮会调用它）。Node 里 navigator 是只读的，得用 defineProperty 覆盖。 */
const clipboard = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async (t) => { clipboard.push(t); } } },
  configurable: true,
  writable: true,
});

/* window.open 替身：记下被打开的地址 */
const opened = [];
globalThis.open = (url) => {
  opened.push(url);
  return null;
};

/* localStorage 替身（引导的「知道了」会写它） */
const lsData = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
    setItem: (k, v) => { lsData.set(String(k), String(v)); },
    removeItem: (k) => { lsData.delete(k); },
  },
  configurable: true,
  writable: true,
});

/* ---------- 假后端 ---------- */

const requests = [];
const repoItem = (full, stars) => ({
  full_name: full,
  description: '示例仓库 ' + full,
  stargazers_count: stars,
  forks_count: 12,
  language: 'Go',
  pushed_at: '2026-10-17T10:00:00Z',
  html_url: 'https://github.com/' + full,
  topics: ['ai', 'demo'],
});

/** 第 1 页给满 25 条（才会有「加载更多」），第 2 页给 5 条（于是到末尾）。 */
const searchBody = (page) => ({
  total_count: 60,
  incomplete_results: false,
  items: page === 1
    ? [repoItem('demo/trending', 1234), ...Array.from({ length: 24 }, (_, i) => repoItem('demo/repo-' + (i + 2), 10 + i))]
    : Array.from({ length: 5 }, (_, i) => repoItem('demo/next-' + (i + 1), 5 + i)),
});

const prefetchCalls = [];

globalThis.fetch = async (input, init) => {
  const url = String(input);
  requests.push(url);
  const reply = (obj) => ({
    ok: true,
    status: 200,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  });

  if (url === '/api/status') {
    return reply({ token: true, tokenError: null, ttlMs: 300000, timeoutMs: 12000, maxAttempts: 4, cacheCount: 7 });
  }
  if (url.startsWith('/api/gh')) {
    const qs = new URLSearchParams(url.split('?')[1] || '');
    const path = decodeURIComponent(qs.get('path') || '');
    const page = Number((/(?:[?&])page=(\d+)/.exec(path) || [])[1] || 1);
    const envelope = (body) => reply({
      ok: true,
      status: 200,
      source: 'network',
      fetchedAt: Date.now(),
      ageMs: 0,
      rate: { remaining: 29, limit: 30, resource: 'search' },
      body,
    });

    // 单个仓库（概览页要读这些字段）
    if (/^repos\/[^/]+\/[^/]+$/.test(path)) {
      const full = path.slice('repos/'.length);
      return envelope({
        full_name: full,
        description: '示例仓库',
        stargazers_count: 1234,
        forks_count: 12,
        open_issues_count: 3,
        size: 2048,
        default_branch: 'main',
        pushed_at: '2026-10-17T10:00:00Z',
        html_url: 'https://github.com/' + full,
        language: 'Go',
      });
    }
    if (/\/languages$/.test(path)) return envelope({ Go: 8000, CSS: 2000 });
    if (/\/readme$/.test(path)) {
      const md = '<div align="center">\n<img src="assets/a.png" alt="示例图" width="820" />\n<sub>▲ 说明文字</sub>\n</div>\n\n# 标题一\n\n第一行正文\n第二行正文\n';
      return envelope({ content: Buffer.from(md, 'utf8').toString('base64') });
    }
    if (/\/contents\/?$/.test(path)) {
      return envelope([
        { name: 'assets', path: 'assets', type: 'dir', html_url: 'https://github.com/demo/trending/tree/HEAD/assets' },
        { name: '.gitignore', path: '.gitignore', type: 'file', size: 24, html_url: 'https://github.com/demo/trending/blob/HEAD/.gitignore' },
        { name: 'pnpm-lock.yaml', path: 'pnpm-lock.yaml', type: 'file', size: 1048576, html_url: 'https://github.com/demo/trending/blob/HEAD/pnpm-lock.yaml' },
        { name: 'README.md', path: 'README.md', type: 'file', size: 2742, html_url: 'https://github.com/demo/trending/blob/HEAD/README.md' },
      ]);
    }
    return envelope(searchBody(page));
  }
  if (url.startsWith('/api/prefetch')) {
    prefetchCalls.push(JSON.parse(init?.body || '{}'));
    return reply({ ok: true, repo: 'x', results: [{ path: 'repos/x', ok: true }] });
  }
  return reply({ ok: false, error: 'unexpected ' + url });
};

/* ---------- 执行 app.js ---------- */

console.log('== 1. app.js 能不能跑起来 ==');
try {
  await import(new URL('app.js', HERE).href);
  check('import 成功（import 里 404/语法错会直接抛）', true);
} catch (e) {
  check('import 成功', false, e.message);
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(1);
}

const el = (id) => document.getElementById(id);

/* index.html 里的标签栏是静态的，这里手工播种一份，好让 tabs.onclick 能被模拟 */
el('tabs').innerHTML = ['overview', 'readme', 'files', 'issues', 'pulls', 'commits']
  .map((k) => '<button data-tab="' + k + '" class="tab">' + k + '</button>')
  .join('');

check('启动哨兵标志被置位', globalThis.__ghLensBoot === true);
check('发现按钮绑好了 onclick', typeof el('exploreBtn').onclick === 'function');
check('刷新按钮绑好了 onclick', typeof el('refreshBtn').onclick === 'function');
check('打开按钮绑好了 onclick', typeof el('goBtn').onclick === 'function');

/* ---------- 1b. 启动引导 ---------- */
console.log('== 1b. 启动引导 ==');
const guideHtml = el('content').innerHTML;
check('启动先给使用说明', guideHtml.includes('gh-lens 是什么'), guideHtml.slice(0, 60));
check('说明覆盖三块界面', guideHtml.includes('① 左栏') && guideHtml.includes('② 顶栏') && guideHtml.includes('③ 主区'));
check('说明给了三步上手', guideHtml.includes('三步上手'));
const guideClose = el('guideClose');
check('说明带「知道了」按钮', typeof guideClose.onclick === 'function');
guideClose.onclick();
check('关掉后记住选择', globalThis.localStorage.getItem('ghLensGuideHidden') === '1', globalThis.localStorage.getItem('ghLensGuideHidden'));
check('关掉后显示空态而不是死白', el('content').innerHTML.includes('看不懂界面'), el('content').innerHTML.slice(0, 60));

/* ---------- 点「发现」 ---------- */
console.log('== 2. 点「发现」 ==');
await el('exploreBtn').onclick();
await sleep(30); // loadExploreResults 是异步的

const panel = el('content').innerHTML;
check('面板渲染出来了', panel.includes('近期热门') && panel.includes('搜仓库') && panel.includes('话题'), panel.slice(0, 80));
check('默认选中近 30 天', /class="chip active" data-days="30"/.test(panel), panel.match(/data-days="\d+"/g));
check('话题 chip 都在', panel.includes('data-topic="ai"') && panel.includes('data-topic="rust"'));

const ghCalls = requests.filter((u) => u.startsWith('/api/gh'));
const pathOf = (u) => new URLSearchParams(String(u).split('?')[1] || '').get('path') || '';
// 注意：页面启动时还会请求 user/repos 填侧栏，所以这里只看 search/* 的调用
const searchCalls = ghCalls.filter((u) => pathOf(u).startsWith('search/'));
check('发出了搜索请求', searchCalls.length >= 1, ghCalls.map(pathOf));
const firstPath = searchCalls.length ? pathOf(searchCalls[0]) : '';
check('请求打到 search/repositories', firstPath.startsWith('search/repositories'), firstPath);
check('带上了 30 天前的 created 过滤', firstPath.includes('created%3A%3E' + daysAgoDate(Date.now(), 30)), firstPath);

const results = el('exploreResults').innerHTML;
check('结果里有仓库名', results.includes('demo/trending'), results.slice(0, 120));
check('结果里有总数', results.includes('共 60 个结果'), results.slice(0, 120));
check('结果里有星数（压缩过）', results.includes('1.2k'), results.slice(0, 200));
check('站内链接而不是直接跳走', results.includes('data-repo="demo/trending"'));
check('外链单独给 ↗', results.includes('github.com/demo/trending'));
check('每行带复制/快照按钮', results.includes('data-copy="demo/trending"') && results.includes('data-snap="demo/trending"'));
check('第一页给了 25 条', (results.match(/data-repo="/g) || []).length === 25, (results.match(/data-repo="/g) || []).length);
check('还有更多时有「加载更多」', results.includes('id="moreBtn"') && results.includes('已显示 25 / 60'));
check('配额徽标显示了搜索额度', el('rateBadge').textContent === '搜索额度 29/30', el('rateBadge').textContent);

/* ---------- 点时间窗 chip ---------- */
console.log('== 3. 点「近 7 天」和话题 chip ==');
const dayChips = el('content').querySelectorAll('.chip[data-days]');
const seven = dayChips.find((c) => c.dataset.days === '7');
check('找到近 7 天的 chip', Boolean(seven));
if (seven) {
  const before = requests.length;
  seven.onclick();
  await sleep(30);  const fresh = requests.slice(before).filter((u) => u.startsWith('/api/gh'));
  const p = fresh.length ? new URLSearchParams(fresh[0].split('?')[1]).get('path') : '';
  check('7 天窗口会用 7 天前的日期', p.includes(daysAgoDate(Date.now(), 7)), p);
}

const topicChips = el('content').querySelectorAll('.chip[data-topic]');
const rust = topicChips.find((c) => c.dataset.topic === 'rust');
check('找到 #rust chip', Boolean(rust));
if (rust) {
  const before = requests.length;
  rust.onclick();
  await sleep(30);
  const fresh = requests.slice(before).filter((u) => u.startsWith('/api/gh'));
  const p = fresh.length ? new URLSearchParams(fresh[0].split('?')[1]).get('path') : '';
  check('话题点击改成 topic 搜索', p.includes('topic%3Arust'), p);
}

/* ---------- 4. 行内操作：打开 / 复制 / 快照 ---------- */
console.log('== 4. 行内打开、复制与快照 ==');
const latestPath = () => {
  const ag = requests.filter((u) => u.startsWith('/api/gh'));
  const last = ag[ag.length - 1];
  return last ? decodeURIComponent(new URLSearchParams(last.split('?')[1]).get('path') || '') : '';
};
check('话题模式下没有 page 参数（第 1 页）', !latestPath().includes('&page='), latestPath());

const openBtns = el('exploreResults').querySelectorAll('button[data-open-url]');
check('找到打开按钮', openBtns.length > 0, openBtns.length);
if (openBtns.length) {
  const want = 'https://github.com/demo/trending';
  check('打开按钮带的是 html_url', openBtns[0].dataset.openUrl === want, openBtns[0].dataset.openUrl);
  await openBtns[0].onclick();
  check('点开会真的开窗口', opened.includes(want), opened);
  check('点开同时复制了链接', clipboard.includes(want), clipboard);
  check('打开后按钮有反馈', openBtns[0].textContent === '已打开', openBtns[0].textContent);
}

const copyBtns = el('exploreResults').querySelectorAll('button[data-copy]');
check('找到复制按钮', copyBtns.length > 0, copyBtns.length);
if (copyBtns.length) {
  const n = clipboard.length;
  await copyBtns[0].onclick();
  check('复制写进了剪贴板', clipboard.slice(n).includes('demo/trending'), clipboard);
  check('复制后按钮有反馈', copyBtns[0].textContent === '已复制', copyBtns[0].textContent);
  check('复制的是 owner/repo 不是链接', clipboard[clipboard.length - 1] === 'demo/trending', clipboard[clipboard.length - 1]);
}

const snapBtns = el('exploreResults').querySelectorAll('button[data-snap]');
check('找到快照按钮', snapBtns.length > 0, snapBtns.length);
if (snapBtns.length) {
  await snapBtns[0].onclick();
  check('快照请求带上仓库名', prefetchCalls.length === 1 && prefetchCalls[0].repo === 'demo/trending', prefetchCalls);
  check('快照完成后按钮有反馈', snapBtns[0].textContent === '已缓存', snapBtns[0].textContent);
}

/* ---------- 5. 加载更多 + 排序 ---------- */
console.log('== 5. 加载更多与排序 ==');
const moreBtn = el('moreBtn');
check('底部有「加载更多」', typeof moreBtn.onclick === 'function');
const beforeMore = requests.length;
moreBtn.onclick();
await sleep(50);
const moreReqs = requests.slice(beforeMore).filter((u) => u.startsWith('/api/gh'));
const morePath = moreReqs.length ? decodeURIComponent(new URLSearchParams(moreReqs[0].split('?')[1]).get('path') || '') : '';
check('加载更多请求第 2 页', morePath.includes('&page=2'), morePath);

const afterMore = el('exploreResults').innerHTML;
check('第 2 页结果追加进来了', afterMore.includes('demo/next-1'), afterMore.slice(-200));
check('第 1 页结果还在', afterMore.includes('demo/trending'));
check('两页合计 30 条', (afterMore.match(/data-repo="/g) || []).length === 30, (afterMore.match(/data-repo="/g) || []).length);
check('到底了就不再有加载更多', afterMore.includes('已到末尾') && !afterMore.includes('id="moreBtn"'), afterMore.slice(-160));

const sortChips = el('content').querySelectorAll('.chip[data-sort]');
const byUpdated = sortChips.find((c) => c.dataset.sort === 'updated');
check('找到「最近更新」排序 chip', Boolean(byUpdated));
if (byUpdated) {
  const before = requests.length;
  byUpdated.onclick();
  await sleep(50);
  const fresh = requests.slice(before).filter((u) => u.startsWith('/api/gh'));
  const p = fresh.length ? decodeURIComponent(new URLSearchParams(fresh[0].split('?')[1]).get('path') || '') : '';
  check('换排序后查询串带 sort=updated', p.includes('sort=updated'), p);
  check('换排序会回到第 1 页', !p.includes('&page='), p);
}

/* ---------- 6. 页内说明与帮助按钮 ---------- */
console.log('== 6. 页内说明与帮助按钮 ==');
const repoLinks = el('exploreResults').querySelectorAll('a[data-repo]');
check('发现结果里有可点的仓库', repoLinks.length > 0, repoLinks.length);
let enteredRepo = false;
if (repoLinks.length) {
  await repoLinks[0].onclick({ preventDefault() {} });
  await sleep(60);
  enteredRepo = true;
  check('进仓库后顶部有本页说明', el('content').innerHTML.includes('这页是仓库名片'), el('content').innerHTML.slice(0, 120));
  check('概览页还渲染了卡片', el('content').innerHTML.includes('★ Stars') || el('content').innerHTML.includes('Stars'), el('content').innerHTML.slice(0, 160));
}
const helpBtn = el('helpBtn');
check('顶栏有 ? 按钮', typeof helpBtn.onclick === 'function');
helpBtn.onclick();
check('? 能把说明叫回来', el('content').innerHTML.includes('gh-lens 是什么'));
el('guideClose').onclick();
await sleep(60);
check('从说明返回原来的仓库页', enteredRepo ? el('content').innerHTML.includes('这页是仓库名片') : true, el('content').innerHTML.slice(0, 100));

/* ---------- 7. README 渲染与文件说明 ---------- */
console.log('== 7. README 渲染与文件说明 ==');
const clickTab = async (name) => {
  const stub = el('tabs').querySelectorAll('.tab').find((x) => x.dataset.tab === name);
  if (!stub) return false;
  await el('tabs').onclick({ target: stub });
  await sleep(60);
  return true;
};

check('能模拟点击 README 标签', await clickTab('readme'));
const readmeHtml = el('content').innerHTML;
check('原始 HTML 不再原样露出来', !readmeHtml.includes('&lt;div') && !readmeHtml.includes('align=&quot;center&quot;'), readmeHtml.slice(0, 160));
check('HTML 里的图片渲染成 <img>', readmeHtml.includes('<img') && readmeHtml.includes('assets/a.png'), readmeHtml.slice(0, 200));
check('相对图片地址补成 raw.githubusercontent.com', readmeHtml.includes('raw.githubusercontent.com/demo/trending/HEAD/assets/a.png'), readmeHtml.slice(0, 240));
check('<sub> 的文字保留、标签去掉', readmeHtml.includes('▲ 说明文字') && !readmeHtml.includes('&lt;sub'));
check('连续两行合成一段', readmeHtml.includes('<p>第一行正文 第二行正文</p>'), readmeHtml.slice(-200));

check('能模拟点击文件标签', await clickTab('files'));
const filesHtml = el('content').innerHTML;
check('文件列表渲染出来了', filesHtml.includes('pnpm-lock.yaml') && filesHtml.includes('README.md'), filesHtml.slice(0, 160));
check('大小换成人读单位', filesHtml.includes('1 MB') && !filesHtml.includes('1048576 B'), filesHtml.slice(0, 260));
check('锁文件有说明', filesHtml.includes('锁文件') && filesHtml.includes('不要手改'), filesHtml.slice(0, 320));
check('目录被标成目录', filesHtml.includes('目录'));
check('README.md 有用途说明', filesHtml.includes('项目说明'));
check('每个条目能去 GitHub 打开', filesHtml.includes('github.com/demo/trending/blob/HEAD/README.md'));
check('文件页也有本页说明', filesHtml.includes('仓库目录树'));

console.log('\n====================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
