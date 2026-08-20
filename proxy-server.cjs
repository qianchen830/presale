#!/usr/bin/env node
// 售前管理 - 静态文件服务 + API 代理
// 参照金蝶交付系统 proxy-server.cjs 结构
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PROXY_PORT || 3211;   // 对外端口
const STATIC_DIR = path.join(__dirname, 'public'); // 前端静态文件
const API_TARGET = 'http://localhost:3210';       // 后端 API

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(STATIC_DIR, pathname === '/' ? '/login.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: 所有路径都返回 index.html（让前端路由工作）
    filePath = path.join(STATIC_DIR, '/login.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  fs.createReadStream(filePath).pipe(res);
}

function proxyRequest(req, res, target) {
  const options = url.parse(target + url.parse(req.url).pathname + (url.parse(req.url).search || ''));
  options.method = req.method;
  options.headers = { ...req.headers };
  options.rejectUnauthorized = false;
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    if ((req.url || '').startsWith('/api/')) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '后端服务暂不可用，请稍后重试' }));
    } else {
      res.writeHead(502);
      res.end('Proxy error: ' + e.message);
    }
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  // CORS（支持 session cookie 跨域）
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname.startsWith('/api/')) {
    proxyRequest(req, res, API_TARGET);
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 售前管理代理已启动: http://0.0.0.0:${PORT}`);
  console.log(`   前端静态: ${STATIC_DIR}`);
  console.log(`   后端API:  ${API_TARGET}\n`);
});
