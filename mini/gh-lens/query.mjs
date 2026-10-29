/**
 * query.mjs —— 搜索查询构造 + 列表整形。
 *
 * 这个文件**不 import 任何东西**（尤其不 import node:*），所以浏览器和 Node
 * 都能直接加载：app.js 走 <script type="module"> 引入它，core.mjs 复用它的
 * shapeRepo，test.mjs 单测它。逻辑只写一遍，不会前端后端两套。
 */

/** 把任意值钳到 [min, max] 的整数；非数字用 fallback。 */
function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** UTC 日期 YYYY-MM-DD。非法输入返回空串。 */
export function isoDate(value) {
  const ms = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** N 天前的 UTC 日期（N 会被取整并夹到 >= 0）。 */
export function daysAgoDate(nowMs, days) {
  const now = Number(nowMs);
  const back = Number(days);
  if (!Number.isFinite(now) || !Number.isFinite(back)) return '';
  return isoDate(now - Math.max(0, Math.floor(back)) * 86400000);
}

/**
 * 构造 GitHub 仓库搜索的 API 相对路径。
 * 返回 null 表示关键词为空（什么也不该搜）。
 *
 * 查询串里的特殊字符全部百分号编码：路径会再经 normalizePath 校验，
 * 所以这里只管拼，不负责去掉 `>` 之类字符。
 */
export function reposSearchQuery({ q, sort = 'stars', perPage = 25, page = 1 } = {}) {
  const text = String(q ?? '').trim();
  if (!text) return null;

  const params = new URLSearchParams();
  params.set('q', text);
  if (sort) params.set('sort', sort);
  params.set('order', 'desc');
  params.set('per_page', String(clampInt(perPage, 1, 100, 25)));
  const p = clampInt(page, 1, 34, 1); // search 最多返回 1000 条
  if (p > 1) params.set('page', String(p));

  return 'search/repositories?' + params.toString();
}

/**
 * 「近期热门」：最近 N 天新建、星数达标的仓库，按星数倒序。
 * 这是 github.com/explore 那类页面的 API 近似——那页本身在这台机器上
 * 加载不出来（15s 超时），只能绕开网页层。
 */
export function trendingQuery({ nowMs = Date.now(), days = 30, minStars = 20, perPage = 25, page = 1, sort = 'stars' } = {}) {
  const cutoff = daysAgoDate(nowMs, days);
  if (!cutoff) return null;
  const stars = clampInt(minStars, 0, 100000000, 20);
  const q = stars > 0 ? `created:>${cutoff} stars:>=${stars}` : `created:>${cutoff}`;
  return reposSearchQuery({ q, sort, perPage, page });
}

/** 按话题搜仓库。话题名只允许字母数字和连字符（GitHub 话题本来就是小写）。 */
export function topicQuery(topic, { perPage = 25, page = 1, sort = 'stars' } = {}) {
  const t = String(topic ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(t)) return null;
  return reposSearchQuery({ q: `topic:${t}`, sort, perPage, page });
}

/** 一个仓库对象裁成 UI 需要的字段。 */
export function shapeRepo(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    full_name: r.full_name ?? '',
    description: r.description ?? '',
    stars: Number(r.stargazers_count ?? 0),
    forks: Number(r.forks_count ?? 0),
    language: r.language ?? null,
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 4) : [],
    private: Boolean(r.private),
    archived: Boolean(r.archived),
    pushed_at: r.pushed_at ?? null,
    html_url: r.html_url ?? '',
  };
}

/** 搜索响应 → { total, incomplete, items }。字段缺失时退化为空，不抛。 */
export function shapeSearch(data) {
  const raw = Array.isArray(data?.items) ? data.items : [];
  const items = raw.map(shapeRepo).filter(Boolean);
  const total = Number.isFinite(data?.total_count) ? data.total_count : items.length;
  return { total, incomplete: Boolean(data?.incomplete_results), items };
}

/** 1234 → "1.2k"，999999 → "1M"。给人看的数字，不允许出现 "1.0k" 这种尾巴。 */
export function compactCount(n) {
  let v = Number(n);
  if (!Number.isFinite(v)) return '?';
  const units = ['', 'k', 'M', 'B'];
  let i = 0;
  while (Math.round(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const text = v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return text + units[i];
}

/**
 * 人读的字节数：1024 → "1 KB"，1500000 → "1.4 MB"。
 * （原来在 core.mjs，为了让浏览器也能用而搬到这里；core.mjs 仍然转导出它。）
 */
export function humanSize(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const num = v >= 10 || i === 0 ? String(Math.round(v)) : v.toFixed(1);
  return `${num.replace(/\.0$/, '')} ${units[i]}`;
}

/** 常见文件名 → 这是什么东西。命中返回 { label, hint }，否则给个按扩展名的粗分类。 */
const FILE_HINTS = [
  [/^readme(\.[a-z]+)?$/i, '文档', '项目说明，就是这个仓库的 README 标签页'],
  [/^(license|licence|copying)(\.[a-z]+)?$/i, '许可', '开源许可证条款'],
  [/^package\.json$/i, '清单', 'Node 包清单：依赖、脚本、入口'],
  [/^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|npm-shrinkwrap\.json)$/i, '锁文件', '锁定每个依赖的确切版本，不要手改'],
  [/^pnpm-workspace\.(yaml|yml)$/i, '配置', 'pnpm 工作区（多包仓库）配置'],
  [/^\.gitignore$/i, '忽略', '告诉 Git 哪些文件不追踪'],
  [/^\.(npmrc|nvmrc|node-version|editorconfig)$/i, '配置', '本地开发工具配置'],
  [/^(tsconfig|jsconfig)(\..*)?\.json$/i, '配置', 'TypeScript / JavaScript 编译配置'],
  [/^(cordis|agent\.cordis)\.(yml|yaml)$/i, '插件', 'DSH 插件的加载配置'],
  [/^cordis\.patch\.yml$/i, '插件', 'DSH 插件配置补丁（覆盖 bundle 默认值）'],
  [/^dockerfile$/i, '容器', 'Docker 镜像构建脚本'],
  [/^docker-compose\.(yml|yaml)$/i, '容器', 'Docker 多容器编排'],
  [/^\.env(\..*)?$/i, '环境', '环境变量（含密钥的文件不应提交）'],
];

const EXT_KINDS = {
  md: ['文档', 'Markdown 文本'],
  txt: ['文本', '纯文本'],
  json: ['JSON', '结构化数据 / 清单'],
  yml: ['YAML', '配置文件'],
  yaml: ['YAML', '配置文件'],
  js: ['JS', 'JavaScript 源码'],
  mjs: ['ESM', 'ES 模块源码'],
  cjs: ['CJS', 'CommonJS 源码'],
  ts: ['TS', 'TypeScript 源码'],
  tsx: ['TSX', 'React 组件'],
  jsx: ['JSX', 'React 组件'],
  css: ['CSS', '样式表'],
  html: ['HTML', '网页'],
  png: ['图片', '位图'],
  jpg: ['图片', '位图'],
  jpeg: ['图片', '位图'],
  webp: ['图片', '位图'],
  gif: ['图片', '动图'],
  svg: ['图片', '矢量图'],
  ico: ['图标', '图标文件'],
  woff: ['字体', 'Web 字体'],
  woff2: ['字体', 'Web 字体'],
  lock: ['锁文件', '不要手改'],
  sh: ['脚本', 'Shell 脚本'],
  cmd: ['脚本', 'Windows 批处理'],
  bat: ['脚本', 'Windows 批处理'],
  ps1: ['脚本', 'PowerShell 脚本'],
  vbs: ['脚本', 'VBScript'],
  py: ['Python', 'Python 源码'],
  rs: ['Rust', 'Rust 源码'],
  go: ['Go', 'Go 源码'],
  java: ['Java', 'Java 源码'],
  c: ['C', 'C 源码'],
  cpp: ['C++', 'C++ 源码'],
  zip: ['压缩包', '二进制压缩文件'],
  pdf: ['PDF', '文档'],
};

/**
 * 判断一个仓库条目是什么。type 是 GitHub 的 'file' / 'dir'。
 * 返回 { label, hint }：label 是短标签（目录/文档/配置…），hint 是一句人话解释。
 */
export function fileKind(name, type) {
  if (type === 'dir' || type === 'submodule') return { label: type === 'dir' ? '目录' : '子模块', hint: '' };
  const n = String(name ?? '');
  if (!n) return { label: '文件', hint: '' };
  for (const [re, label, hint] of FILE_HINTS) {
    if (re.test(n)) return { label, hint };
  }
  const parts = n.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  const hit = EXT_KINDS[ext];
  if (hit) return { label: hit[0], hint: hit[1] };
  return { label: '文件', hint: '' };
}

/**
 * 把 README 里的内联 HTML 变成 markdown/纯文本，避免把 <div align="center"> 原样显示出来。
 * 纯函数，不碰 DOM —— 浏览器和 Node（单测）共用。
 *
 * @param {string} text 原始 README
 * @param {string} repo full_name，用于把相对路径补成 raw.githubusercontent.com 的绝对地址
 */
export function mdPreprocess(text, repo = '') {
  let s = String(text ?? '').replace(/\r\n/g, '\n');

  const abs = (url, kind) => {
    const u = String(url || '').trim();
    if (!u || /^(https?:|data:|mailto:|#|\/\/)/i.test(u)) return u;
    if (!repo) return u;
    const clean = u.replace(/^\.?\//, '');
    return kind === 'img'
      ? `https://raw.githubusercontent.com/${repo}/HEAD/${clean}`
      : `https://github.com/${repo}/blob/HEAD/${clean}`;
  };

  // <img src="..." alt="..." width="..."> → ![alt](绝对地址)
  s = s.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
    const src = (/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || '';
    const alt = (/\balt\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
    return src ? `![${alt}](${abs(src, 'img')})` : '';
  });

  // <a href="...">label</a> → [label](绝对地址)
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (m, attrs, label) => {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || '';
    const text = String(label).replace(/<[^>]+>/g, '').trim();
    return href ? `[${text}](${abs(href, 'link')})` : text;
  });

  // 换行标签
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // 其余标签一律去掉（保留中间的文字），<sub>/<details>/<summary> 之类都靠这条
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // 连续空行压成一个
  s = s.replace(/\n{3,}/g, '\n\n');
  return s;
}
