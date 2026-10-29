/* gh-lens 前端 */

import { trendingQuery, topicQuery, reposSearchQuery, shapeSearch, compactCount, humanSize, fileKind, mdPreprocess } from './query.mjs';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  repoInput: $('repoInput'),
  goBtn: $('goBtn'),
  refreshBtn: $('refreshBtn'),
  snapBtn: $('snapBtn'),
  exploreBtn: $('exploreBtn'),
  repoList: $('repoList'),
  cacheInfo: $('cacheInfo'),
  crumb: $('crumb'),
  sourceBadge: $('sourceBadge'),
  ageBadge: $('ageBadge'),
  rateBadge: $('rateBadge'),
  notice: $('notice'),
  tabs: $('tabs'),
  content: $('content'),
  stopBtn: $('stopBtn'),
  helpBtn: $('helpBtn'),
};

const state = {
  repo: null,
  tab: 'overview',
  loading: false,
  view: 'repo', // 'repo' | 'explore'
  explore: { mode: 'trending', days: 30, topic: '', q: '', sort: 'stars' },
};

/** 「发现」里的快捷话题。 */
const TOPICS = ['ai', 'llm', 'agents', 'mcp', 'rust', 'typescript', 'python', 'go', 'cli', 'self-hosted'];

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtAge(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒前';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' 分钟前';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.round(h / 24) + ' 天前';
}

function b64utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 极简 markdown 渲染：先把内联 HTML（<div align="center">、<img>、<a>…）降级成
 * markdown/纯文本，再转义，再处理常见块。够看 README，且不会把标签原样吐在页面上。
 */
function md(text) {
  let s = esc(mdPreprocess(text, state.repo));

  // 代码块
  const blocks = [];
  s = s.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\u0000BLOCK' + (blocks.length - 1) + '\u0000';
  });

  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2" loading="lazy" />')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

  const out = [];
  const lines = s.split('\n');
  let listType = null;
  let tableBuf = [];
  /** 连续普通行合成一个段落（GitHub 就是这么做的，避免一行一个 <p>） */
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const flushList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  };
  const flushTable = () => {
    if (tableBuf.length >= 2) {
      const rows = tableBuf.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      if (rows.length) {
        let html = '<table><thead><tr>' + cells(rows[0]).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
        for (const r of rows.slice(1)) {
          html += '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>';
        }
        html += '</tbody></table>';
        out.push(html);
      }
    }
    tableBuf = [];
  };

  for (const line of lines) {
    if (/\u0000BLOCK\d+\u0000/.test(line)) {
      flushPara(); flushList(); flushTable();
      out.push(line.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)]));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      tableBuf.push(line);
      continue;
    }
    if (tableBuf.length) flushTable();

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lvl = Math.min(h[1].length, 3);
      out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      out.push('<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara(); flushTable();
      if (listType !== 'ul') { flushList(); out.push('<ul>'); listType = 'ul'; }
      out.push('<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara(); flushTable();
      if (listType !== 'ol') { flushList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + inline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr />'); continue; }

    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList(); flushTable();
  return out.join('\n');
}

/* ---------- API ---------- */
async function api(path, { force = false } = {}) {
  const url = '/api/gh?path=' + encodeURIComponent(path) + (force ? '&force=1' : '');
  const res = await fetch(url);
  const json = await res.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
  paintSource(json);
  return json;
}

function paintSource(r) {
  const map = {
    network: ['数据来自网络', 'net', '刚刚从 GitHub API 抓到的'],
    'cache-fresh': ['数据来自本地缓存', 'fresh', '缓存还没过期，所以没联网——不消耗额度'],
    'cache-stale': ['数据是旧缓存', 'stale', '网络抓取失败，退回到上一次成功的结果'],
  };
  const [label, cls, tip] = map[r.source] || ['—', '', ''];
  el.sourceBadge.textContent = label;
  el.sourceBadge.className = 'badge ' + cls;
  el.sourceBadge.title = tip;
  el.ageBadge.textContent = r.fetchedAt ? fmtAge(r.ageMs) + '抓取' : '';
  el.ageBadge.title = '这份数据是什么时候抓的（你可以点「刷新」强制重抓）';
  paintRate(r.rate);
  if (r.source === 'cache-stale') {
    el.notice.hidden = false;
    el.notice.textContent = '网络请求失败（' + (r.error || '未知原因') + '），当前显示的是 ' + fmtAge(r.ageMs) + '抓取的缓存。';
  } else {
    el.notice.hidden = true;
  }
}

/** 配额徽标。搜索的额度（30/分钟）和普通接口（5000/小时）分开算，很关键。 */
function paintRate(rate) {
  if (!rate || !Number.isFinite(rate.remaining)) {
    el.rateBadge.textContent = '';
    el.rateBadge.className = 'badge';
    el.rateBadge.title = '';
    return;
  }
  const search = rate.resource === 'search';
  el.rateBadge.textContent = (search ? '搜索额度 ' : '接口额度 ') + rate.remaining +
    (Number.isFinite(rate.limit) ? '/' + rate.limit : '');
  el.rateBadge.title = search
    ? 'GitHub 搜索接口：每分钟最多 30 次。命中缓存不消耗额度，额度用完等一分钟即可。'
    : 'GitHub 普通接口：每小时最多 5000 次。命中缓存不消耗额度。';
  const cls = rate.remaining <= 0 ? 'bad' : search && rate.remaining <= 2 ? 'warn' : '';
  el.rateBadge.className = 'badge ' + cls;
}

function busy(on) {
  el.goBtn.disabled = on;
  el.refreshBtn.disabled = on;
  el.snapBtn.disabled = on;
  if (on) el.content.innerHTML = '<div class="loading">加载中…</div>';
}

function showError(msg) {
  el.content.innerHTML = '<div class="err">' + esc(msg) + '</div>';
}

/* ---------- 使用说明（首次进入自动显示，右上角 ? 随时叫回来） ---------- */
const GUIDE_KEY = 'ghLensGuideHidden';

function guideHidden() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function guideHtml() {
  return '<div class="guide">' +
    '<div class="guide-head">' +
      '<h2>gh-lens 是什么</h2>' +
      '<button id="guideClose" class="btn small">知道了</button>' +
    '</div>' +
    '<p class="dim">一个带本地缓存的 GitHub 浏览器：网络抖动时用上一次抓到的缓存顶上，恢复后自动刷新，' +
    '所以它比直接开 github.com 更稳。下面三块就是全部界面。</p>' +
    '<div class="guide-grid">' +
      '<div class="gcard"><div class="gk">① 左栏 · 去哪</div>' +
        '<div>顶部输入 <code>owner/repo</code>（或直接粘贴 GitHub 链接）回车打开；' +
        '「我的仓库」列出你账号下最近更新的 50 个；<b>发现</b> 用来找新仓库（热门 / 话题 / 搜索）；' +
        '<b>离线快照</b> 把当前仓库的数据全部存进本机；最底下「停止服务」关掉后台进程。</div></div>' +
      '<div class="gcard"><div class="gk">② 顶栏 · 数据靠不靠谱</div>' +
        '<div><b>数据来自网络 / 本地缓存 / 旧缓存</b>：这一屏的数字是哪来的。<br>' +
        '<b>3 分钟前抓取</b>：数据年龄。<br>' +
        '<b>搜索额度 29/30</b>：GitHub 接口还剩多少次（搜索 30 次/分钟，普通接口 5000 次/小时）。<br>' +
        '鼠标停在徽标上都有完整说明。</div></div>' +
      '<div class="gcard"><div class="gk">③ 主区 · 看什么</div>' +
        '<div><b>概览</b> 仓库名片（星数/体积/语言）；<b>README</b> 排版后的自述；' +
        '<b>文件</b> 目录树，点进去看源码；<b>Issues / PR / 提交</b> 各取最近 30 条，点标题跳 GitHub。' +
        '每页顶部都有一行说明。</div></div>' +
    '</div>' +
    '<div class="guide-steps"><div class="gk">三步上手</div><ol>' +
      '<li>左栏输入 <code>owner/repo</code>，或点「我的仓库」里的一项</li>' +
      '<li>在主区切标签页看内容</li>' +
      '<li>想离线看就点「离线快照」，之后断网也能打开这个仓库</li>' +
    '</ol></div>' +
    '<p class="dim">右上角的 <b>?</b> 随时能把这份说明叫回来。</p>' +
    '</div>';
}

function showGuide() {
  el.content.innerHTML = guideHtml();
  const close = $('guideClose');
  if (close) {
    close.onclick = () => {
      try {
        localStorage.setItem(GUIDE_KEY, '1');
      } catch {
        /* 隐私模式忽略 */
      }
      if (state.repo) renderTab(state.tab, false);
      else showEmpty();
    };
  }
}

function showEmpty() {
  el.content.innerHTML = '<div class="empty">' +
    '<h2>在左边输入 <code>owner/repo</code></h2>' +
    '<p>或者点「我的仓库」里的一项，也可以点左边的 <b>发现</b> 看热门 / 搜仓库。</p>' +
    '<p class="dim">想离线看就点「离线快照」——之后断网也能打开这个仓库。</p>' +
    '<p><button id="emptyHelp" class="btn small">看不懂界面？看一遍说明</button></p>' +
    '</div>';
  const again = $('emptyHelp');
  if (again) again.onclick = () => showGuide();
}

/* ---------- 侧栏 ---------- */
async function loadStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    el.cacheInfo.textContent = '缓存条目 ' + s.cacheCount + ' · 新鲜期 ' + (s.ttlMs > 0 ? Math.round(s.ttlMs / 1000) + ' 秒' : '永久');
    if (!s.token) {
      el.status.className = 'status bad';
      el.status.textContent = '未加载 token：' + (s.tokenError || '未知') + '　（只能匿名访问，限额很低）';
    } else {
      el.status.className = 'status ok';
      el.status.textContent = 'token 已加载 · 重试 ' + s.maxAttempts + ' 次 · 超时 ' + s.timeoutMs + 'ms';
    }
  } catch {
    el.status.className = 'status bad';
    el.status.textContent = '本地服务没有响应';
  }
}

async function loadRepos(force = false) {
  el.repoList.innerHTML = '<div class="loading" style="padding:8px 10px">加载中…</div>';
  const r = await api('user/repos?sort=updated&per_page=50', { force });
  if (!r.ok || !Array.isArray(r.body)) {
    el.repoList.innerHTML = '<div class="err" style="padding:8px 10px">' + esc(r.error || '读取失败') + '</div>';
    return;
  }
  el.repoList.innerHTML = '';
  for (const repo of r.body) {
    const b = document.createElement('button');
    b.className = 'repoitem';
    b.innerHTML = '<div class="name">' + esc(repo.full_name) + '</div>' +
      '<div class="meta">' + (repo.private ? '私有 · ' : '') + '★' + repo.stargazers_count +
      (repo.language ? ' · ' + esc(repo.language) : '') + '</div>';
    b.onclick = () => openRepo(repo.full_name);
    el.repoList.appendChild(b);
  }
}

/* ---------- 主区 ---------- */
function normalizeRepoInput(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i) ||
    s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? m[1] + '/' + m[2].replace(/\.git$/, '') : null;
}

async function openRepo(fullName, force = false) {
  const norm = normalizeRepoInput(fullName);
  if (!norm) return showError('格式不对，应该是 owner/repo');
  state.view = 'repo';
  state.repo = norm;
  state.tab = 'overview';
  el.crumb.textContent = norm;
  el.tabs.hidden = false;
  for (const t of el.tabs.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === 'overview');
  for (const it of el.repoList.querySelectorAll('.repoitem')) {
    it.classList.toggle('active', it.textContent.includes(norm));
  }
  await renderTab('overview', force);
}

/** 每个标签页顶部的一句话说明——第一次用的人靠它知道「这页是干什么的」。 */
const TAB_HINTS = {
  overview: '这页是仓库名片：星数、fork、issue 数、体积、语言占比、许可证。数字都是 GitHub 的实时值（或缓存值，看右上角徽标）。',
  readme: '项目自述文件，渲染成排版后的样子。左边侧栏点「发现」或输入其他 owner/repo 可以换仓库。',
  files: '仓库目录树。点文件夹进下一层，点文件直接看源码（二进制或超大文件会显示占位提示）。',
  issues: '最近 30 条 issue（不含 PR）。点标题到 GitHub 网页看完整讨论和评论。',
  pulls: '最近 30 条 Pull Request，含草稿/已合并状态。点标题到 GitHub 网页看 diff。',
  commits: '最近 30 次提交，显示作者和提交时间。点消息到 GitHub 网页看这次提交改了什么。',
};

function tabHint(tab) {
  const text = TAB_HINTS[tab];
  if (!text) return '';
  return '<p class="tabhint">' + esc(text) + '</p>';
}

async function renderTab(tab, force = false) {
  state.tab = tab;
  busy(true);
  try {
    if (tab === 'overview') await renderOverview(force);
    else if (tab === 'readme') await renderReadme(force);
    else if (tab === 'files') await renderFiles(force);
    else if (tab === 'issues') await renderIssues(force);
    else if (tab === 'pulls') await renderPulls(force);
    else if (tab === 'commits') await renderCommits(force);

    // 渲染成功后把「这页是干什么的」贴在最上面；出错时不动（错误信息已经够直接）
    if (tabHint(tab) && !el.content.innerHTML.startsWith('<div class="err"')) {
      el.content.innerHTML = tabHint(tab) + el.content.innerHTML;
    }
  } catch (e) {
    showError('渲染失败：' + e.message);
  } finally {
    busy(false);
  }
}

async function renderOverview(force) {
  const repo = await api('repos/' + state.repo, { force });
  if (!repo.ok) return showError(repo.error || '读取仓库失败');
  const r = repo.body;

  const lang = await api('repos/' + state.repo + '/languages', { force });
  const langs = lang.ok && lang.body ? Object.entries(lang.body).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];

  const parts = [];
  parts.push('<div class="cards">' +
    card('★ Stars', r.stargazers_count) +
    card('Forks', r.forks_count) +
    card('Open issues', r.open_issues_count) +
    card('体积', Math.round((r.size || 0) / 1024) + ' MB') +
    card('默认分支', esc(r.default_branch)) +
    card('最近推送', esc((r.pushed_at || '').slice(0, 10))) +
    '</div>');

  parts.push('<div class="prose">');
  parts.push('<p>' + esc(r.description || '（无描述）') + '</p>');
  if (langs.length) {
    parts.push('<p class="dim">语言：' + langs.map(([k, v]) => esc(k) + ' (' + Math.round((v / langs.reduce((a, [, b]) => a + b, 0)) * 100) + '%)').join('、') + '</p>');
  }
  parts.push('<p><a href="' + esc(r.html_url) + '" target="_blank" rel="noreferrer noopener">在 GitHub 打开 →</a></p>');
  if (r.license?.spdx_id) parts.push('<p class="dim">许可证：' + esc(r.license.spdx_id) + '</p>');
  if (r.archived) parts.push('<p class="dim">⚠ 仓库已归档</p>');
  parts.push('</div>');
  el.content.innerHTML = parts.join('\n');
}

function card(k, v) {
  return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
}

async function renderReadme(force) {
  const r = await api('repos/' + state.repo + '/readme', { force });
  if (!r.ok) return showError(r.error || '这个仓库没有 README，或读取失败');
  const text = b64utf8(r.body.content || '');
  el.content.innerHTML = '<div class="prose">' + md(text) + '</div>';
}

async function renderFiles(force, subPath = '') {
  const p = 'repos/' + state.repo + '/contents/' + subPath;
  const r = await api(p, { force });
  if (!r.ok) return showError(r.error || '读取目录失败');

  if (!Array.isArray(r.body)) {
    // 单文件
    const text = r.body.content ? b64utf8(r.body.content) : '（二进制或过大文件）';
    el.content.innerHTML = '<p class="dim">' + esc(r.body.path || subPath) + ' · ' +
      humanSize(r.body.size) + ' · 只显示前 200 KB</p>' +
      '<pre class="raw">' + esc(text.slice(0, 200000)) + '</pre>';
    return;
  }

  const parts = [];
  if (subPath) {
    parts.push('<p><button class="btn small" id="upBtn">↑ 上一级（' + esc(subPath) + '）</button></p>');
  }
  parts.push('<div class="filelist">');

  const sorted = r.body.slice().sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  for (const f of sorted) {
    const kind = fileKind(f.name, f.type);
    const isDir = f.type === 'dir';
    parts.push('<div class="fileitem' + (isDir ? ' dir' : '') + '">' +
      '<span class="fkind">' + esc(kind.label) + '</span>' +
      '<span class="fmain">' +
        '<a href="#" data-path="' + esc(f.path) + '" data-type="' + esc(f.type) + '">' + esc(f.name) + '</a>' +
        (kind.hint ? '<span class="fhint">' + esc(kind.hint) + '</span>' : '') +
      '</span>' +
      '<span class="fsize">' + (isDir ? '' : humanSize(f.size)) + '</span>' +
      (f.html_url
        ? '<a class="ext" href="' + esc(f.html_url) + '" target="_blank" rel="noreferrer noopener" title="在 GitHub 打开">↗</a>'
        : '<span class="ext"></span>') +
      '</div>');
  }
  parts.push('</div>');
  el.content.innerHTML = parts.join('');

  for (const a of el.content.querySelectorAll('a[data-path]')) {
    a.onclick = (ev) => {
      ev.preventDefault();
      renderFiles(true, a.dataset.path);
    };
  }
  const up = $('upBtn');
  if (up) up.onclick = () => renderFiles(true, subPath.split('/').slice(0, -1).join('/'));
}

async function renderIssues(force) {
  const r = await api('repos/' + state.repo + '/issues?state=all&per_page=30', { force });
  if (!r.ok) return showError(r.error || '读取 issues 失败');
  const list = r.body.filter((i) => !i.pull_request);
  if (!list.length) return void (el.content.innerHTML = '<p class="dim">没有 issue。</p>');
  el.content.innerHTML = list.map((i) =>
    '<div class="row"><span class="num">#' + i.number + '</span>' +
    '<span class="title"><a href="' + esc(i.html_url) + '" target="_blank" rel="noreferrer noopener">' + esc(i.title) + '</a>' +
    '<div class="sub">' + esc(i.user?.login || '') + ' · ' + esc((i.created_at || '').slice(0, 10)) +
    (i.comments ? ' · ' + i.comments + ' 条评论' : '') +
    (i.labels?.length ? ' · ' + i.labels.map((l) => esc(l.name || l)).join(', ') : '') + '</div></span>' +
    '<span class="pill ' + (i.state === 'open' ? 'open' : 'closed') + '">' + esc(i.state) + '</span></div>'
  ).join('');
}

async function renderPulls(force) {
  const r = await api('repos/' + state.repo + '/pulls?state=all&per_page=30', { force });
  if (!r.ok) return showError(r.error || '读取 PR 失败');
  if (!r.body.length) return void (el.content.innerHTML = '<p class="dim">没有 pull request。</p>');
  el.content.innerHTML = r.body.map((p) => {
    const cls = p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed';
    const label = p.merged_at ? 'merged' : p.state;
    return '<div class="row"><span class="num">#' + p.number + '</span>' +
      '<span class="title"><a href="' + esc(p.html_url) + '" target="_blank" rel="noreferrer noopener">' + esc(p.title) + '</a>' +
      '<div class="sub">' + esc(p.user?.login || '') + ' · ' + esc((p.created_at || '').slice(0, 10)) + (p.draft ? ' · 草稿' : '') + '</div></span>' +
      '<span class="pill ' + cls + '">' + label + '</span></div>';
  }).join('');
}

async function renderCommits(force) {
  const r = await api('repos/' + state.repo + '/commits?per_page=30', { force });
  if (!r.ok) return showError(r.error || '读取提交失败');
  if (!r.body.length) return void (el.content.innerHTML = '<p class="dim">没有提交。</p>');
  el.content.innerHTML = r.body.map((c) =>
    '<div class="row"><span class="num">' + esc(String(c.sha).slice(0, 7)) + '</span>' +
    '<span class="title"><a href="' + esc(c.html_url) + '" target="_blank" rel="noreferrer noopener">' +
    esc((c.commit?.message || '').split('\n')[0]) + '</a>' +
    '<div class="sub">' + esc(c.commit?.author?.name || '') + ' · ' + esc((c.commit?.author?.date || '').slice(0, 16).replace('T', ' ')) + '</div></span></div>'
  ).join('');
}

/* ---------- 发现 ---------- */

/** 排序选项：值要和 GitHub 的 sort 参数对得上。 */
const SORTS = [['stars', '★ 星数'], ['updated', '⏱ 最近更新'], ['forks', '⑂ fork']];
/** 每页条数；GitHub 搜索最多返回 1000 条。 */
const PER_PAGE = 25;
const MAX_RESULTS = 1000;

/** 当前「发现」视图要请求的 API 路径（page 从 1 开始）。 */
function explorePath(page = 1) {
  const ex = state.explore;
  if (ex.mode === 'trending') return trendingQuery({ days: ex.days, page, sort: ex.sort, perPage: PER_PAGE });
  if (ex.mode === 'topic') return topicQuery(ex.topic, { page, sort: ex.sort, perPage: PER_PAGE });
  if (ex.mode === 'search') return reposSearchQuery({ q: ex.q, page, sort: ex.sort, perPage: PER_PAGE });
  return null;
}

/** 「发现」里已累积的结果（翻页追加，跨重绘保留）。 */
const exploreRes = { items: [], total: 0, incomplete: false, page: 1, hasMore: false };

function openExplore(opts = {}) {
  state.view = 'explore';
  Object.assign(state.explore, opts);
  el.crumb.textContent = '发现';
  el.tabs.hidden = true;
  for (const it of el.repoList.querySelectorAll('.repoitem')) it.classList.remove('active');
  renderExplore();
}

function renderExplore() {
  const ex = state.explore;
  const parts = ['<div class="explore">'];

  parts.push('<div class="exrow"><span class="exlabel">近期热门</span>');
  for (const d of [7, 30, 90]) {
    const on = ex.mode === 'trending' && ex.days === d;
    parts.push('<button class="chip' + (on ? ' active' : '') + '" data-days="' + d + '">近 ' + d + ' 天</button>');
  }
  parts.push('<span class="exhint">最近 N 天新建 · explore 的 API 近似</span></div>');

  parts.push('<div class="exrow"><span class="exlabel">排序</span>');
  for (const [key, label] of SORTS) {
    const on = ex.sort === key;
    parts.push('<button class="chip' + (on ? ' active' : '') + '" data-sort="' + key + '">' + label + '</button>');
  }
  parts.push('</div>');

  parts.push(
    '<div class="exrow"><span class="exlabel">搜仓库</span>' +
      '<input id="exInput" class="exinput" spellcheck="false" autocomplete="off" ' +
      'placeholder="关键词，支持 stars:&gt;1000 language:go topic:ai 等语法" ' +
      'value="' + esc(ex.q) + '" />' +
      '<button id="exGo" class="btn small">搜索</button></div>'
  );

  parts.push('<div class="exrow"><span class="exlabel">话题</span>');
  for (const t of TOPICS) {
    const on = ex.mode === 'topic' && ex.topic === t;
    parts.push('<button class="chip' + (on ? ' active' : '') + '" data-topic="' + esc(t) + '">#' + esc(t) + '</button>');
  }
  parts.push('</div>');

  parts.push('<div id="exploreResults"></div>');
  parts.push('</div>');
  el.content.innerHTML = parts.join('\n');

  wireExplore();
  loadExploreResults();
}

function wireExplore() {
  for (const b of el.content.querySelectorAll('.chip[data-days]')) {
    b.onclick = () => {
      state.explore.mode = 'trending';
      state.explore.days = Number(b.dataset.days);
      renderExplore();
    };
  }
  for (const b of el.content.querySelectorAll('.chip[data-sort]')) {
    b.onclick = () => {
      state.explore.sort = b.dataset.sort;
      renderExplore();
    };
  }
  for (const b of el.content.querySelectorAll('.chip[data-topic]')) {
    b.onclick = () => {
      state.explore.mode = 'topic';
      state.explore.topic = b.dataset.topic;
      renderExplore();
    };
  }
  const input = $('exInput');
  const go = $('exGo');
  const doSearch = () => {
    const q = input.value.trim();
    if (!q) {
      el.notice.hidden = false;
      el.notice.textContent = '先输个关键词再搜。';
      return;
    }
    state.explore.mode = 'search';
    state.explore.q = q;
    renderExplore();
  };
  if (go) go.onclick = doSearch;
  if (input) {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') doSearch();
      else if (e.key === 'Escape') { input.value = ''; input.blur(); }
    };
  }
}

function repoRow(x) {
  const meta = [
    x.language ? esc(x.language) : '',
    '★ ' + compactCount(x.stars),
    x.forks ? 'fork ' + compactCount(x.forks) : '',
    x.pushed_at ? '更新 ' + esc(String(x.pushed_at).slice(0, 10)) : '',
  ].filter(Boolean).join(' · ');

  const topics = (x.topics || []).slice(0, 3)
    .map((t) => '<span class="pill">#' + esc(t) + '</span>')
    .join(' ');

  const flag = x.private ? '<span class="pill">私有</span>'
    : x.archived ? '<span class="pill closed">归档</span>' : '';

  return '<div class="row"><span class="num">★ ' + compactCount(x.stars) + '</span>' +
    '<span class="title">' +
      '<a href="#" data-repo="' + esc(x.full_name) + '">' + esc(x.full_name) + '</a> ' +
      '<a class="ext" href="' + esc(x.html_url) + '" target="_blank" rel="noreferrer noopener" title="在 GitHub 打开">↗</a>' +
      (x.description ? '<div class="sub">' + esc(x.description) + '</div>' : '') +
      '<div class="sub">' + meta + '</div>' +
      (topics ? '<div class="sub">' + topics + '</div>' : '') +
    '</span>' +
    '<span class="rowacts">' +
      '<button class="mini" data-open-url="' + esc(x.html_url) + '" title="复制链接并在浏览器打开">打开</button>' +
      '<button class="mini" data-copy="' + esc(x.full_name) + '" title="复制 owner/repo">复制</button>' +
      '<button class="mini" data-snap="' + esc(x.full_name) + '" title="把这个仓库的关键数据缓存下来，之后断网也能看">快照</button>' +
    '</span>' +
    flag + '</div>';
}

/** 把当前累积的结果画进 #exploreResults。 */
function renderResults() {
  const box = $('exploreResults');
  if (!box) return;

  const ex = state.explore;
  const scope = ex.mode === 'trending' ? ' · 近 ' + ex.days + ' 天'
    : ex.mode === 'topic' ? ' · #' + esc(ex.topic) : ' · ' + esc(ex.q);
  const sortLabel = (SORTS.find(([k]) => k === ex.sort) || ['', ''])[1];
  const head = '<p class="dim">共 ' + compactCount(exploreRes.total) + ' 个结果' + scope +
    ' · ' + sortLabel + (exploreRes.incomplete ? '（GitHub 标记为不完整）' : '') + '</p>';

  if (!exploreRes.items.length) {
    box.innerHTML = head + '<p class="dim">没有结果。换个关键词，或者把时间窗放宽。</p>';
    return;
  }

  const foot = exploreRes.hasMore
    ? '<button id="moreBtn" class="btn small">加载更多</button>' +
      '<span class="dim">已显示 ' + exploreRes.items.length + ' / ' + compactCount(Math.min(exploreRes.total, MAX_RESULTS)) + '</span>'
    : '<span class="dim">已到末尾，共 ' + exploreRes.items.length + ' 条</span>';

  box.innerHTML = head + exploreRes.items.map(repoRow).join('') +
    '<div id="moreFoot" class="morefoot">' + foot + '</div>';

  wireRows(box);
  const more = $('moreBtn');
  if (more) more.onclick = () => loadExploreResults(false, { append: true });
}

/** 行内按钮：进站内浏览、复制 owner/repo、直接快照。 */
function wireRows(box) {
  for (const a of box.querySelectorAll('a[data-repo]')) {
    a.onclick = (ev) => {
      ev.preventDefault();
      openRepo(a.dataset.repo);
    };
  }

  for (const b of box.querySelectorAll('button[data-open-url]')) {
    b.onclick = async () => {
      const url = b.dataset.openUrl;
      // 先开窗口再 await：两者都要在点击手势的时间窗里，否则会被浏览器拦弹窗。
      try {
        window.open(url, '_blank', 'noopener');
      } catch {
        /* 弹窗被拦也不影响下面的复制 */
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        /* 剪贴板不可用 */
      }
      b.textContent = copied ? '已打开' : '已开窗口';
      b.classList.add('ok');
      setTimeout(() => {
        b.textContent = '打开';
        b.classList.remove('ok');
      }, 1400);
      if (!copied) {
        el.notice.hidden = false;
        el.notice.textContent = '窗口已打开，但剪贴板不可用，链接：' + url;
      }
    };
  }

  for (const b of box.querySelectorAll('button[data-copy]')) {
    b.onclick = async () => {
      const text = b.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = '已复制';
        b.classList.add('ok');
        setTimeout(() => {
          b.textContent = '复制';
          b.classList.remove('ok');
        }, 1200);
      } catch {
        el.notice.hidden = false;
        el.notice.textContent = '剪贴板不可用，请手动复制：' + text;
      }
    };
  }

  for (const b of box.querySelectorAll('button[data-snap]')) {
    b.onclick = async () => {
      const repo = b.dataset.snap;
      b.disabled = true;
      b.textContent = '缓存中…';
      try {
        const res = await fetch('/api/prefetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo }),
        });
        const j = await res.json();
        const okCount = (j.results || []).filter((x) => x.ok).length;
        b.textContent = okCount ? '已缓存' : '失败';
        b.classList.add(okCount ? 'ok' : 'bad');
        loadStatus();
      } catch {
        b.textContent = '失败';
        b.classList.add('bad');
        b.disabled = false;
      }
    };
  }
}

/**
 * 取「发现」的结果。append=true 时加载下一页并追加（按 full_name 去重）。
 */
async function loadExploreResults(force = false, { append = false } = {}) {
  const box = $('exploreResults');
  if (!box) return;

  const page = append ? exploreRes.page + 1 : 1;
  const path = explorePath(page);
  if (!path) {
    box.innerHTML = '<p class="dim">没有可搜的内容。</p>';
    return;
  }

  if (!append) {
    exploreRes.items = [];
    exploreRes.total = 0;
    exploreRes.incomplete = false;
    exploreRes.hasMore = false;
    exploreRes.page = 1;
    box.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  } else {
    const btn = $('moreBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '加载中…';
    }
  }

  const r = await api(path, { force });

  if (!r.ok) {
    if (append) {
      const foot = $('moreFoot');
      if (foot) {
        foot.innerHTML = '<span class="err">第 ' + page + ' 页加载失败：' + esc(r.error || '未知原因') + '</span>' +
          '<button id="moreBtn" class="btn small">重试</button>';
      }
      const retry = $('moreBtn');
      if (retry) retry.onclick = () => loadExploreResults(false, { append: true });
    } else {
      box.innerHTML = '<div class="err">' + esc(r.error || '搜索失败') + '</div>';
    }
    return;
  }

  exploreRes.page = page;
  const shaped = shapeSearch(r.body);
  const seen = new Set(exploreRes.items.map((x) => x.full_name));
  for (const it of shaped.items) {
    if (!seen.has(it.full_name)) {
      seen.add(it.full_name);
      exploreRes.items.push(it);
    }
  }
  exploreRes.total = shaped.total;
  exploreRes.incomplete = shaped.incomplete;
  exploreRes.hasMore = shaped.items.length >= PER_PAGE
    && exploreRes.items.length < Math.min(shaped.total, MAX_RESULTS)
    && page < MAX_RESULTS / PER_PAGE;

  renderResults();
}

/* ---------- 事件 ---------- */
el.goBtn.onclick = () => openRepo(el.repoInput.value, true);
el.repoInput.onkeydown = (e) => { if (e.key === 'Enter') el.goBtn.click(); };

/* 聚焦即全选：像地址栏一样，下次直接粘贴新地址就覆盖掉旧的。
   注意：鼠标点击时 focus 先触发（此时全选），紧接着的 mouseup 默认行为会把
   选区塌成光标，所以要在 mouseup 上拦一次默认行为。键盘 Tab 进来没有
   mouseup，选区自然保留。 */
let selectPending = false;

el.repoInput.addEventListener('focus', () => {
  if (!el.repoInput.value) return;
  el.repoInput.select();
  selectPending = true;
});

el.repoInput.addEventListener('mouseup', (e) => {
  if (!selectPending) return;
  e.preventDefault();
  selectPending = false;
});

el.repoInput.addEventListener('blur', () => {
  selectPending = false;
});
el.refreshBtn.onclick = () => {
  if (state.view === 'explore') return loadExploreResults(true);
  return state.repo ? renderTab(state.tab, true) : loadRepos(true);
};

el.exploreBtn.onclick = () => openExplore();

el.snapBtn.onclick = async () => {
  if (!state.repo) return showError('先打开一个仓库再点「离线快照」');
  el.snapBtn.disabled = true;
  el.snapBtn.textContent = '抓取中…';
  try {
    const res = await fetch('/api/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: state.repo }),
    });
    const j = await res.json();
    const okCount = (j.results || []).filter((x) => x.ok).length;
    el.notice.hidden = false;
    el.notice.textContent = '离线快照完成：' + okCount + '/' + (j.results || []).length + ' 项已缓存，之后断网也能看这个仓库的概览、README、文件、issues、PR、提交。';
    loadStatus();
  } catch (e) {
    showError('离线快照失败：' + e.message);
  } finally {
    el.snapBtn.disabled = false;
    el.snapBtn.textContent = '离线快照';
  }
};

el.tabs.onclick = (e) => {
  const b = e.target.closest('.tab');
  if (!b || !state.repo) return;
  for (const t of el.tabs.querySelectorAll('.tab')) t.classList.toggle('active', t === b);
  renderTab(b.dataset.tab);
};

/* 停止服务：调用 /api/shutdown 结束后台进程。
   用 .vbs 无窗口启动时，这是唯一天然、不用翻任务管理器的退出方式。 */
if (el.stopBtn) {
  el.stopBtn.onclick = async () => {
    if (!confirm('停止本地服务？停止后这个页面就取不到新数据了（关掉页面即可，缓存还在磁盘上）。')) return;
    el.stopBtn.disabled = true;
    el.stopBtn.textContent = '正在停止…';
    try {
      const res = await fetch('/api/shutdown', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'HTTP ' + res.status);
      document.body.classList.add('stopped');
      el.status.className = 'status bad';
      el.status.textContent = '服务已停止。可以关掉这个页面了；下次点桌面图标会重新启动。';
      el.stopBtn.textContent = '已停止';
      el.notice.hidden = false;
      el.notice.textContent = '本地服务已退出。缓存仍在磁盘（.cache/），下次启动直接命中。';
    } catch (e) {
      el.stopBtn.disabled = false;
      el.stopBtn.textContent = '停止服务';
      el.notice.hidden = false;
      el.notice.textContent = '停止失败：' + e.message;
    }
  };
}

/* 右上角 ? ：随时把使用说明叫回来 */
if (el.helpBtn) el.helpBtn.onclick = () => showGuide();

/* ---------- 启动 ---------- */
window.__ghLensBoot = true; // 告诉 index.html 的启动哨兵：脚本跑起来了
if (guideHidden()) showEmpty();
else showGuide();
loadStatus();
loadRepos();
