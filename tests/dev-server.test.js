import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

test('development server serves the complete browser module graph and bundled font', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: {...process.env, PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.once('error', error => {clearTimeout(timeout); reject(error);});
      child.once('exit', code => {clearTimeout(timeout); reject(new Error(`Server exited: ${code}`));});
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('Web app ready:')) {clearTimeout(timeout); resolve();}
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const html = await (await fetch(origin)).text();
    const queue = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map(match => match[1]);
    queue.push('/rule-engine.js');
    const visited = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (visited.has(path)) continue;
      visited.add(path);
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, `${path} must be served`);
      if (path.endsWith('.js')) {
        assert.match(response.headers.get('content-type'), /javascript/);
        const script = await response.text();
        for (const match of script.matchAll(/from\s*['"](\.\/[^'"]+)['"]/g)) {
          queue.push(new URL(match[1], origin + path).pathname);
        }
      } else if (path.endsWith('.woff2')) {
        assert.equal(response.headers.get('content-type'), 'font/woff2');
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), 'wOF2');
      }
    }
    assert.ok(visited.has('/rule-engine.js'));
    assert.ok(visited.has('/fonts/PretendardVariable.woff2'));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
