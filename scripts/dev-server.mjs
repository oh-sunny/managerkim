import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/document-extract.js', ['document-extract.js', 'text/javascript; charset=utf-8']],
  ['/message-templates.js', ['message-templates.js', 'text/javascript; charset=utf-8']],
]);
const requestedPort = process.env.PORT ?? '3000';
if (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const port = Number(requestedPort);

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = assets.get(pathname);
  if (!asset) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const html = await readFile(new URL(`../prototype/${asset[0]}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': asset[1],
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(`정적 파일 제공 실패: ${pathname} (${error.code ?? error.message})`);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`요청한 파일을 읽지 못했습니다: ${pathname}. 실행 폴더의 prototype 파일을 확인해주세요.`);
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `${port} 포트가 사용 중입니다. 다른 PORT를 지정하거나 기존 실행을 종료해주세요.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Prototype ready: http://localhost:${port}`));
