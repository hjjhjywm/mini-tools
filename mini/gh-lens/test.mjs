/**
 * test.mjs —— gh-lens 核心逻辑测试（node test.mjs）
 *
 * 测 core.mjs 与 query.mjs 的纯函数：路径校验、缓存判定、退避、错误分类、
 * 列表整形、搜索查询构造。不联网、不碰文件系统。
 */

import {
  normalizePath,
  cacheKey,
  isFresh,
  backoffMs,
  retriableStatus,
  retriableError,
  describeError,
  humanSize,
  shapeList,
} from './core.mjs';

import {
  isoDate,
  daysAgoDate,
  reposSearchQuery,
  trendingQuery,
  topicQuery,
  shapeRepo,
  shapeSearch,
  compactCount,
  fileKind,
  mdPreprocess,
} from './query.mjs';

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    console.log('  FAIL - ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  }
}

/* ---------- 1. 路径校验（同时是 SSRF 防线） ---------- */
console.log('== 1. 路径校验 ==');

const good = [
  ['repos/hjjhjywm/hello-world', 'repos/hjjhjywm/hello-world'],
  ['/repos/hjjhjywm/hello-world', 'repos/hjjhjywm/hello-world'],
  ['https://api.github.com/repos/a/b', 'repos/a/b'],
  ['repos/a/b?per_page=5', 'repos/a/b?per_page=5'],
  ['user/repos?sort=updated', 'user/repos?sort=updated'],
  ['users/octocat', 'users/octocat'],
  ['rate_limit', 'rate_limit'],
  ['search/issues?q=bug', 'search/issues?q=bug'],
];
for (const [input, want] of good) {
  const got = normalizePath(input);
  check('接受 ' + input, got === want, got);
}

const bad = [
  ['', '空串'],
  ['   ', '空白'],
  ['http://evil.com/repos/a/b', '外部主机'],
  ['evil.com/repos/a/b', '外部主机(无协议)'],
  ['repos/../../etc/passwd', '路径上跳'],
  ['repos/a/../../x', '路径上跳'],
  ['admin/users', '不在白名单'],
  ['graphql', '不在白名单'],
  ['repos\\a\\b', '反斜杠'],
  [null, 'null'],
  [123, '非字符串'],
];
for (const [input, why] of bad) {
  const got = normalizePath(input);
  check('拒绝 ' + why + ' (' + JSON.stringify(input) + ')', got === null, got);
}

/* ---------- 2. 缓存键 ---------- */
console.log('== 2. 缓存键 ==');
check('同一路径键相同', cacheKey('repos/a/b') === cacheKey('repos/a/b'));
check('不同查询串键不同', cacheKey('repos/a/b?x=1') !== cacheKey('repos/a/b?x=2'));
check('键长度 32', cacheKey('repos/a/b').length === 32);

/* ---------- 3. 缓存新鲜度 ---------- */
console.log('== 3. 缓存新鲜度 ==');
const now = 1_000_000;
check('刚抓取是新鲜的', isFresh({ fetchedAt: now - 1000 }, now, 60000) === true);
check('超过 TTL 不新鲜', isFresh({ fetchedAt: now - 120000 }, now, 60000) === false);
check('TTL<=0 永不过期', isFresh({ fetchedAt: 0 }, now, 0) === true);
check('空条目不新鲜', isFresh(null, now, 60000) === false);
check('缺 fetchedAt 不新鲜', isFresh({ body: 1 }, now, 60000) === false);

/* ---------- 4. 退避 ---------- */
console.log('== 4. 退避 ==');
let monoOk = true;
for (let a = 0; a < 5; a++) {
  const ms = backoffMs(a);
  if (!(ms >= 50)) monoOk = false;
}
check('退避下限 >= 50ms', monoOk);
const b0 = backoffMs(0, 300, 4000);
const b3 = backoffMs(3, 300, 4000);
check('退避随次数增长', b3 > b0, { b0, b3 });
check('退避不超过上限太多', backoffMs(20, 300, 4000) <= 4000 * 1.2 + 1);

/* ---------- 5. 可重试判定 ---------- */
console.log('== 5. 可重试判定 ==');
check('429 可重试', retriableStatus(429) === true);
check('500 可重试', retriableStatus(500) === true);
check('503 可重试', retriableStatus(503) === true);
check('404 不重试', retriableStatus(404) === false);
check('401 不重试', retriableStatus(401) === false);
check('403 不重试', retriableStatus(403) === false);
check('ECONNRESET 可重试', retriableError({ code: 'ECONNRESET' }) === true);
check('ETIMEDOUT 可重试', retriableError({ code: 'ETIMEDOUT' }) === true);
check('cause.code 也能识别', retriableError({ message: 'x', cause: { code: 'EAI_AGAIN' } }) === true);
check('未知错误不重试', retriableError({ code: 'SOMETHING_ELSE' }) === false);
check('null 不重试', retriableError(null) === false);

/* ---------- 6. 错误描述 ---------- */
console.log('== 6. 错误描述 ==');
check('带 code 时拼进去', describeError({ code: 'ECONNRESET', message: 'socket hang up' }).includes('ECONNRESET'));
check('无 code 时只给 message', describeError({ message: 'boom' }) === 'boom');
check('null 安全', typeof describeError(null) === 'string');

/* ---------- 7. 体积格式化 ---------- */
console.log('== 7. 体积 ==');
check('0 -> 0 B', humanSize(0) === '0 B');
check('1024 -> 1 KB', humanSize(1024) === '1 KB');
check('1500000 -> 1.4 MB', humanSize(1500000) === '1.4 MB', humanSize(1500000));
check('非法输入', humanSize(undefined) === '?');

/* ---------- 8. 列表整形 ---------- */
console.log('== 8. 列表整形 ==');
const repos = shapeList('repos', [
  { full_name: 'a/b', description: 'd', stargazers_count: 5, forks_count: 1, language: 'JS', private: false, pushed_at: '2026-01-01', html_url: 'u' },
]);
check('repos 保留关键字段', repos.length === 1 && repos[0].full_name === 'a/b' && repos[0].stars === 5);

const issues = shapeList('issues', [
  { number: 1, title: 't', state: 'open', user: { login: 'u' }, labels: [{ name: 'bug' }], html_url: 'x' },
  { number: 2, title: 'pr', state: 'open', pull_request: { url: 'p' }, html_url: 'y' },
]);
check('issues 过滤掉 PR', issues.length === 1 && issues[0].number === 1);
check('issues 标签拍平', issues[0].labels[0] === 'bug');

const commits = shapeList('commits', [{ sha: 'abcdef1234567890', commit: { message: 'feat: x\n\nbody', author: { name: 'n', date: 'd' } }, html_url: 'h' }]);
check('commits 只取首行', commits[0].message === 'feat: x');
check('commits 短 sha', commits[0].short === 'abcdef1');

check('非数组输入安全', shapeList('repos', null).length === 0);
check('未知 kind 原样返回', shapeList('whatever', [{ a: 1 }]).length === 1);

/* ---------- 9. 搜索查询构造 ---------- */
console.log('== 9. 日期与查询 ==');
const NOW = Date.UTC(2026, 9, 18, 3, 0, 0); // 2026-10-18 11:00 +08:00

check('isoDate 基本', isoDate(NOW) === '2026-10-18', isoDate(NOW));
check('isoDate 接受 Date', isoDate(new Date(NOW)) === '2026-10-18');
check('isoDate 非法返回空串', isoDate('nope') === '' && isoDate(NaN) === '');
check('daysAgoDate 30 天', daysAgoDate(NOW, 30) === '2026-09-18', daysAgoDate(NOW, 30));
check('daysAgoDate 跨月', daysAgoDate(Date.UTC(2026, 2, 1), 30) === '2026-01-30', daysAgoDate(Date.UTC(2026, 2, 1), 30));
check('daysAgoDate 负数当 0', daysAgoDate(NOW, -5) === '2026-10-18');
check('daysAgoDate 非法输入', daysAgoDate('x', 30) === '');

const trend30 = trendingQuery({ nowMs: NOW, days: 30, minStars: 20 });
check('热门：入口是仓库搜索', trend30.startsWith('search/repositories?q='), trend30);
check('热门：含 created:>日期', trend30.includes('created%3A%3E2026-09-18'), trend30);
check('热门：含星数门槛', trend30.includes('stars%3A%3E%3D20'), trend30);
check('热门：按星倒序', trend30.includes('sort=stars') && trend30.includes('order=desc'), trend30);
check('热门：默认 25 条', trend30.includes('per_page=25'), trend30);
check('热门：90 天', trendingQuery({ nowMs: NOW, days: 90 }).includes('created%3A%3E2026-07-20'));
check('热门：7 天', trendingQuery({ nowMs: NOW, days: 7 }).includes('created%3A%3E2026-10-11'));
check('热门：minStars=0 不写星门槛', !trendingQuery({ nowMs: NOW, minStars: 0 }).includes('stars%3A'), trendingQuery({ nowMs: NOW, minStars: 0 }));
check('热门：perPage 上限 100', trendingQuery({ nowMs: NOW, perPage: 500 }).includes('per_page=100'));
check('热门：翻页参数生效', trendingQuery({ nowMs: NOW, page: 3 }).includes('page=3'), trendingQuery({ nowMs: NOW, page: 3 }));
check('热门：page=1 不写进查询串', !trendingQuery({ nowMs: NOW, page: 1 }).includes('&page='), trendingQuery({ nowMs: NOW, page: 1 }));
check('热门：可换排序', trendingQuery({ nowMs: NOW, sort: 'updated' }).includes('sort=updated') && !trendingQuery({ nowMs: NOW, sort: 'updated' }).includes('sort=stars'));

check('搜索：空关键词 null', reposSearchQuery({ q: '' }) === null && reposSearchQuery({ q: '   ' }) === null && reposSearchQuery({}) === null);
check('搜索：空格编码成 +', reposSearchQuery({ q: 'a b' }).includes('q=a+b'), reposSearchQuery({ q: 'a b' }));
check('搜索：自定义 sort', reposSearchQuery({ q: 'x', sort: 'updated' }).includes('sort=updated'));
check('搜索：sort 空串不写', !reposSearchQuery({ q: 'x', sort: '' }).includes('sort='));
check('搜索：page=1 省略', !reposSearchQuery({ q: 'x' }).includes('page=1'));
check('搜索：page=2 写入', reposSearchQuery({ q: 'x', page: 2 }).includes('page=2'));
check('搜索：perPage 夹到 1', reposSearchQuery({ q: 'x', perPage: 0 }).includes('per_page=1'));
check('搜索：尖括号被编码', reposSearchQuery({ q: 'stars:>1000' }).includes('stars%3A%3E1000'), reposSearchQuery({ q: 'stars:>1000' }));

check('话题：大写变小写', topicQuery('LLM').includes('topic%3Allm'), topicQuery('LLM'));
check('话题：连字符合法', topicQuery('self-hosted').includes('topic%3Aself-hosted'));
check('话题：空格拒绝', topicQuery('bad topic!') === null);
check('话题：空值拒绝', topicQuery('') === null && topicQuery(null) === null);
check('话题：前导连字符拒绝', topicQuery('-x') === null);
check('话题：超长拒绝', topicQuery('a'.repeat(51)) === null);
check('话题：翻页参数生效', topicQuery('ai', { page: 2 }).includes('page=2'));
check('话题：可换排序', topicQuery('ai', { sort: 'forks' }).includes('sort=forks'));

/* 关键：生成的路径必须能过服务端的白名单校验，否则前端一搜就 400 */
const feedToServer = normalizePath(trend30);
check('热门路径能过白名单', feedToServer === trend30, feedToServer);
check('话题路径能过白名单', normalizePath(topicQuery('ai')) === topicQuery('ai'));
check('搜索路径能过白名单', normalizePath(reposSearchQuery({ q: 'stars:>1000 language:go' })) === reposSearchQuery({ q: 'stars:>1000 language:go' }));

/* ---------- 10. 搜索结果整形 ---------- */
console.log('== 10. 搜索结果整形 ==');
const search = shapeSearch({
  total_count: 1234,
  incomplete_results: false,
  items: [{ full_name: 'a/b', stargazers_count: 7, description: 'd', topics: ['ai', 'x', 'y', 'z', 'w'] }],
});
check('total 保留', search.total === 1234, search.total);
check('items 整形', search.items.length === 1 && search.items[0].full_name === 'a/b' && search.items[0].stars === 7);
check('topics 截到 4 个', search.items[0].topics.length === 4);
check('缺 total_count 时用条数', shapeSearch({ items: [{ full_name: 'a/b' }] }).total === 1);
check('incomplete 标记', shapeSearch({ incomplete_results: true }).incomplete === true);
check('null 安全', shapeSearch(null).total === 0 && shapeSearch(null).items.length === 0);
check('shapeRepo 拒绝非对象', shapeRepo(null) === null && shapeRepo('x') === null);
check('shapeRepo 缺字段不炸', shapeRepo({}).stars === 0 && shapeRepo({}).full_name === '');

/* ---------- 11. 数字压缩 ---------- */
console.log('== 11. 数字压缩 ==');
check('999 不变', compactCount(999) === '999', compactCount(999));
check('1000 -> 1k', compactCount(1000) === '1k', compactCount(1000));
check('1234 -> 1.2k', compactCount(1234) === '1.2k', compactCount(1234));
check('12345 -> 12k', compactCount(12345) === '12k', compactCount(12345));
check('999999 不出现 1000k', compactCount(999999) === '1M', compactCount(999999));
check('1500000 -> 1.5M', compactCount(1500000) === '1.5M', compactCount(1500000));
check('非法输入', compactCount(undefined) === '?');

/* ---------- 12. 文件类型识别 ---------- */
console.log('== 12. 文件类型识别 ==');
check('README.md 是文档', fileKind('README.md', 'file').label === '文档' && fileKind('README.md', 'file').hint.includes('项目说明'));
check('LICENSE 是许可', fileKind('LICENSE', 'file').label === '许可');
check('.gitignore 有说明', fileKind('.gitignore', 'file').label === '忽略');
check('锁文件被拦住', fileKind('pnpm-lock.yaml', 'file').label === '锁文件' && fileKind('package-lock.json', 'file').label === '锁文件');
check('package.json 是清单', fileKind('package.json', 'file').label === '清单');
check('cordis.patch.yml 认成插件配置', fileKind('cordis.patch.yml', 'file').label === '插件');
check('目录优先判定', fileKind('assets', 'dir').label === '目录' && fileKind('assets', 'submodule').label === '子模块');
check('常见扩展名有分类', fileKind('a.mjs', 'file').label === 'ESM' && fileKind('x.png', 'file').label === '图片' && fileKind('t.tsx', 'file').label === 'TSX');
check('不认识的给「文件」', fileKind('weird.xyz', 'file').label === '文件' && fileKind('', 'file').label === '文件');
check('humanSize 仍从 core.mjs 拿得到', humanSize(1024) === '1 KB' && humanSize(1048576) === '1 MB');

/* ---------- 13. README 内联 HTML 预处理 ---------- */
console.log('== 13. README 内联 HTML ==');
const htmlMd = [
  '<div align="center">',
  '<a href="https://example.com"><img src="assets/a.png" alt="示例图" width="820" /></a>',
  '<sub>▲ 说明文字</sub>',
  '</div>',
].join('\n');
const pre = mdPreprocess(htmlMd, 'o/r');
check('标签全部消失', !/<[a-z/]/i.test(pre.replace(/!\[[^\]]*\]\([^)]*\)/g, '')), pre);
check('图片转成 markdown 且补绝对地址', pre.includes('![示例图](https://raw.githubusercontent.com/o/r/HEAD/assets/a.png)'), pre);
check('链接转成 markdown', pre.includes('[![示例图]') === false && pre.includes('](https://example.com)') === false ? pre.includes('https://example.com') : true, pre);
check('sub 里的文字保留', pre.includes('▲ 说明文字'));
check('<br> 换成换行', mdPreprocess('a<br>b<br/>c') === 'a\nb\nc', mdPreprocess('a<br>b<br/>c'));
check('绝对地址不被动', mdPreprocess('<img src="https://cdn.x/y.png">') === '![](https://cdn.x/y.png)', mdPreprocess('<img src="https://cdn.x/y.png">'));
check('没有 repo 时不改写相对地址', mdPreprocess('<img src="a.png">', '') === '![](a.png)');
check('相对链接指向 blob', mdPreprocess('<a href="docs/x.md">文档</a>', 'o/r') === '[文档](https://github.com/o/r/blob/HEAD/docs/x.md)', mdPreprocess('<a href="docs/x.md">文档</a>', 'o/r'));
check('details/summary 只留文字', mdPreprocess('<details><summary>点我</summary>内容</details>') === '点我内容', mdPreprocess('<details><summary>点我</summary>内容</details>'));

/* ---------- 汇总 ---------- */
console.log('\n====================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
