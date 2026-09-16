import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { localArtwork } from './local-artwork.mjs';

test('workbench pages compile without importing private images into Astro', async () => {
  const { transform } = await import('../node_modules/@astrojs/compiler/dist/node/index.js');
  for (const page of ['dev', 'screenshots', 'logos', 'social']) {
    const source = await readFile(new URL(`../src/pages/${page}.astro`, import.meta.url), 'utf8');
    const result = await transform(source, { filename: `${page}.astro` });
    assert(!result.diagnostics.some(diagnostic => diagnostic.severity === 1));
    assert.doesNotMatch(source, /astro:assets|phoneGeometry|set:html/);
  }
  const source = await readFile(new URL('./catalog-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /image.loading = 'lazy'/);
  assert.match(source, /node.textContent = text/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|set:html/);
  assert.doesNotMatch(await readFile(new URL('../preview.config.mjs', import.meta.url), 'utf8'), /localArtwork/);
});

test('local HTTP rejects foreign hosts/origins, paths, oversized or concurrent renders and edited logo bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'artwork-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>';
  const sha = createHash('sha256').update(svg).digest('hex');
  const file = 'app/assets/brand/generated/symbol/black-on-transparent/artwork.svg';
  await put(file, svg);
  await put('app/assets/brand/generated/manifest.json', { variants: [{ layout: 'symbol', theme: 'black-on-transparent', svg: 'generated/symbol/black-on-transparent/artwork.svg' }] });
  let middleware;
  localArtwork({ repoRoot: root }).configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const port = server.address().port, host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const send = (path, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end(body);
  });
  for (const badHost of [`localhost.evil:${port}`, 'evil.test', `127.0.0.1:${port + 1}`, `localhost:${port}@evil.test`])
    assert.equal((await send('/__artwork/sources', { headers: { Host: badHost } })).status, 403);
  for (const badOrigin of ['null', 'https://' + host, origin + '/', `http://localhost:${port}`, 'http://evil.test'])
    assert.equal((await send('/__artwork/sources', { headers: { Origin: badOrigin } })).status, 403);
  for (const path of ['/__artwork/catalog', '/__artwork/image/../../package.json', '/__artwork/image/' + 'a'.repeat(64)])
    assert.equal((await send(path)).status, 404);
  assert.equal((await send('/__artwork/render')).status, 405);
  assert.equal((await send('/__artwork/render', { method: 'POST' })).status, 403);
  assert.equal((await send('/__artwork/render', { method: 'POST', headers: { Origin: origin } })).status, 415);
  const post = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } };
  assert.equal((await send('/__artwork/render', { ...post, body: '{' })).status, 422);
  assert.equal((await send('/__artwork/render', { ...post, body: 'x'.repeat(17000) })).status, 413);
  const slow = request({ host: '127.0.0.1', port, path: '/__artwork/render', method: 'POST', headers: post.headers });
  slow.on('error', () => {}); slow.write('{');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await send('/__artwork/render', { ...post, body: '{}' })).status, 429);
  slow.end('}');
  const catalog = await send('/__artwork/sources');
  assert.equal(catalog.status, 200); assert.equal(catalog.headers['access-control-allow-origin'], undefined);
  const image = await send(`/__artwork/image/${sha}`);
  assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/svg+xml');
  assert.match(image.headers['content-security-policy'], /sandbox/); assert.equal(image.body.toString(), svg);
  const head = await send(`/__artwork/image/${sha}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  await put(file, '<svg><script>alert(1)</script></svg>');
  assert.equal((await send(`/__artwork/image/${sha}`)).status, 409);
  const refreshed = JSON.parse((await send('/__artwork/sources')).body);
  assert.equal(refreshed.logos[0].outputs.length, 0);
});
