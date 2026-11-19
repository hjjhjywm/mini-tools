// 教学模式测试：配置读写、prompt 构建、SSE 流式解析（用本地 mock 服务器）
import http from 'node:http';
import { Board, RED } from '../app/engine.js';
import {
  loadTeachConfig,
  saveTeachConfig,
  defaultConfig,
  buildSituation,
  streamTeach,
  PRESET_QUESTIONS,
} from '../app/teach.js';

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

console.log('=== 1. 配置读写 ===');
{
  const d = loadTeachConfig();
  ok(d.baseUrl === 'https://api.deepseek.com/v1', '默认 baseUrl 正确');
  ok(d.model === 'deepseek-chat', '默认 model 正确');
  ok(d.apiKey === '', '默认无 key');
  ok(d.enabled === false, '默认未启用');

  saveTeachConfig({ enabled: true, apiKey: 'sk-test', baseUrl: 'https://x.com/v1', model: 'm1', temperature: 0.5 });
  const c = loadTeachConfig();
  ok(c.apiKey === 'sk-test', '保存后能读回 key');
  ok(c.model === 'm1', '保存后能读回 model');
  ok(c.enabled === true, '保存后 enabled 为 true');

  // 脏数据兜底
  store.set('xiangqi.teach.v1', '{bad json}');
  const bad = loadTeachConfig();
  ok(bad.apiKey === '', '坏 JSON 兜底成默认配置');
}

console.log('\n=== 2. 局面摘要 ===');
{
  const b = new Board();
  const s = buildSituation(b, null);
  ok(s.side === '红方', '识别走子方');
  ok(s.boardText.split('\n').length === 10, '棋盘文本 10 行');
  ok(s.material.red.includes('车'), '红方子力含车');
  ok(s.material.black.includes('卒'), '黑方子力含卒');
  ok(s.inCheck === false, '开局未被将军');

  // 带 hint 的摘要
  const s2 = buildSituation(b, { notation: '炮二平五', scoreText: '势均力敌', reasons: ['占据中路'] });
  ok(s2.analysis.includes('炮二平五'), '摘要含推荐着法');
  ok(s2.analysis.includes('占据中路'), '摘要含理由');
}

console.log('\n=== 3. SSE 流式解析（本地 mock 服务器）===');
{
  // 起一个假的 OpenAI 兼容服务
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // 验证请求体
      const j = JSON.parse(body);
      const okReq = j.stream === true && j.messages && j.messages.length === 2 && !!j.model;
      if (!okReq) {
        res.writeHead(400).end(JSON.stringify({ error: { message: 'bad request' } }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // 分块发送
      const chunks = ['当前', '局面', '红方', '占据', '中路', '优势。'];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          res.write('data: [DONE]\n\n');
          clearInterval(timer);
          res.end();
          return;
        }
        const payload = { choices: [{ delta: { content: chunks[i] } }] };
        res.write('data: ' + JSON.stringify(payload) + '\n\n');
        i++;
      }, 15);
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const cfg = { apiKey: 'sk-mock', baseUrl, model: 'mock', temperature: 0.7 };

  // 流式接收
  const received = [];
  let firstChunkTime = 0;
  const t0 = Date.now();

  const full = await streamTeach(cfg, '测试问题', (delta) => {
    if (!firstChunkTime) firstChunkTime = Date.now();
    received.push(delta);
  });

  const elapsed = Date.now() - t0;

  ok(full === '当前局面红方占据中路优势。', `完整文本正确（实际 ${full}）`);
  ok(received.length === 6, `分 6 次收到（实际 ${received.length}）`);
  ok(firstChunkTime > 0 && firstChunkTime - t0 < elapsed, `流式：首字 ${firstChunkTime - t0}ms，总计 ${elapsed}ms`);
  ok(received.join('') === full, '分块拼接等于完整文本');

  // 错误处理：401
  const badCfg = { ...cfg, apiKey: '' };
  let threw = false;
  let errMsg = '';
  try {
    await streamTeach(badCfg, 'x', () => {});
  } catch (e) {
    threw = true;
    errMsg = e.message;
  }
  ok(threw && errMsg.includes('API Key'), `无 key 时报错（${errMsg}）`);

  // 错误处理：服务端 400
  const badModel = { ...cfg, model: '' };
  let threw2 = false;
  try {
    await streamTeach(badModel, 'x', () => {});
  } catch (e) {
    threw2 = true;
  }
  ok(threw2, '服务端返回错误时能抛出');

  server.close();
}

console.log('\n=== 4. 预设问题 ===');
{
  ok(Array.isArray(PRESET_QUESTIONS), '预设问题是数组');
  ok(PRESET_QUESTIONS.length >= 4, `至少 4 个预设（实际 ${PRESET_QUESTIONS.length}）`);
  for (const p of PRESET_QUESTIONS) {
    ok(typeof p.label === 'string' && typeof p.q === 'string' && p.label && p.q,
       `预设「${p.label}」格式正确`);
  }
}

console.log('\n=== 5. 取消请求 ===');
{
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 故意只发一个块就挂着，测试 abort
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '开始' } }] }) + '\n\n');
    // 不结束
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const cfg = { apiKey: 'sk', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' };
  const ctrl = new AbortController();

  const p = streamTeach(cfg, 'x', () => {}, ctrl.signal).catch((e) => e);

  await new Promise((r) => setTimeout(r, 100));
  ctrl.abort();

  const result = await p;
  ok(result instanceof Error && result.name === 'AbortError', '能正确取消请求');

  server.close();
}

console.log(`\n教学模式测试：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
