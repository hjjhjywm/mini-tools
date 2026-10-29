#!/usr/bin/env node
/**
 * 把 app/ 下的 HTML/CSS/JS 内联成一个自包含的 index.html
 * 生成 dist/中国象棋.html —— 双击用默认浏览器打开即可游玩，零运行时依赖
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const APP = path.join(ROOT, 'app');
const DIST = path.join(ROOT, 'dist');

function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

let html = read('index.html');
const css = read('style.css');

// 核心 JS 模块（保持顺序：engine → ai → endgames → replay → sound → main，依赖在前）
let engineJs = read('engine.js');
let aiJs = read('ai.js');
let endgamesJs = read('endgames.js');
let replayJs = read('replay.js');
let soundJs = read('sound.js');
let mainJs = read('main.js');

// 所有模块顶部都有 import 语句，内联后统一改成一个作用域，需要全部去掉。
// 同时支持单行和多行 import（多行时会跨行匹配到 from '...' 结尾）。
function stripLocalImports(src) {
  // 先处理多行 import：import { ... } from './xxx.js';
  let out = src.replace(
    /^[ \t]*import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/[^'"]+['"];?[ \t]*\r?\n/gm,
    ''
  );
  // 再处理单行无大括号的形式：import x from './xxx.js';
  out = out.split('\n')
    .filter((line) => !/^\s*import\s.*from\s+['"]\.\/[^'"]+['"]/.test(line))
    .join('\n');
  return out;
}

mainJs = stripLocalImports(mainJs);
soundJs = stripLocalImports(soundJs);
replayJs = stripLocalImports(replayJs);
endgamesJs = stripLocalImports(endgamesJs);
aiJs = stripLocalImports(aiJs);
engineJs = stripLocalImports(engineJs);

function stripExports(src) {
  return src
    // 纯粹的 re-export 语句整体删掉：export { A, B };
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    // 声明式导出去掉 export 关键字
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .replace(/^export\s+default\s+/gm, '');
}

engineJs = stripExports(engineJs);
aiJs = stripExports(aiJs);
endgamesJs = stripExports(endgamesJs);
replayJs = stripExports(replayJs);
soundJs = stripExports(soundJs);

const bundle = [
  '(function(){',
  '"use strict";',
  '/* ===== engine.js ===== */',
  engineJs,
  '/* ===== ai.js ===== */',
  aiJs,
  '/* ===== endgames.js ===== */',
  endgamesJs,
  '/* ===== replay.js ===== */',
  replayJs,
  '/* ===== sound.js ===== */',
  soundJs,
  '/* ===== main.js ===== */',
  mainJs,
  '})();',
].join('\n');

// 替换外链样式
html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="[^"]*style\.css"[^>]*>/,
  `<style>\n${css}\n</style>`
);
if (!html.includes('<style>')) {
  html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
}

// 替换外链模块脚本
html = html.replace(
  /<script[^>]*type="module"[^>]*src="[^"]*main\.js"[^>]*><\/script>/,
  `<script>\n${bundle}\n</script>`
);
if (!html.includes('<script>\n(function(){')) {
  html = html.replace('</body>', `<script>\n${bundle}\n</script>\n</body>`);
}

fs.mkdirSync(DIST, { recursive: true });
const outFile = path.join(DIST, '中国象棋.html');
fs.writeFileSync(outFile, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✅ 已生成单文件版：${outFile}（${kb} KB）`);
console.log('   双击即可用默认浏览器打开，无需安装任何运行时');
