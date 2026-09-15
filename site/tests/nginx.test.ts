import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

const site = new URL('../', import.meta.url);
const template = await readFile(new URL('nginx/default.conf.template', site), 'utf8');
const entrypoint = await readFile(new URL('nginx/15-site-env.sh', site), 'utf8');

test('proxy configuration preserves exact page precedence and verification', () => {
  expect(template.indexOf('location = /releases {')).toBeLessThan(template.indexOf('location ^~ /releases/'));
  expect(template.indexOf('location = /releases/ {')).toBeLessThan(template.indexOf('location ^~ /releases/'));
  expect(template).toContain('proxy_ssl_verify on');
  expect(template).toContain('proxy_pass $artifact_origin$request_uri');
  expect(template).toContain('access_log off');
  expect(template).not.toMatch(/https:\/\/[^$]/);
});

test('container entrypoint rejects injected origins and accepts an empty origin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sovran-site-env-'));
  try {
    await writeFile(join(dir, 'template'), template);
    const script = entrypoint.replaceAll('/etc/nginx/templates/default.conf.template', `${dir}/template`).replaceAll('/etc/nginx/conf.d/default.conf', `${dir}/result`);
    for (const origin of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com:443', 'https://example.com;return 200', 'https://example.com\n}', 'https://example.com?token=x']) {
      expect(spawnSync('sh', ['-c', script], { env: { ...process.env, ARTIFACT_ORIGIN: origin } }).status).not.toBe(0);
    }
    for (const origin of ['', 'https://artifacts.example.com']) {
      const result = spawnSync('sh', ['-c', script], { env: { ...process.env, PORT: '8080', ARTIFACT_ORIGIN: origin, ARTIFACT_RESOLVER: '1.1.1.1' }, encoding: 'utf8' });
      expect(result.status).toBe(0);
      const config = await readFile(join(dir, 'result'), 'utf8');
      expect(config).toContain(`set $artifact_origin "${origin}"`);
      expect(config).toContain('proxy_pass $artifact_origin$request_uri');
      expect(config).toContain('listen 8080;');
      expect(config).not.toContain('${');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('real nginx serves pages, retires sensitive paths, redirects 11 locales, and fails closed', async () => {
  const available = spawnSync('nginx', ['-v']);
  if (available.error) throw new Error('nginx is required for runtime smoke coverage; install it or report this gate as unrun');
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No local test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'sovran-site-nginx-'));
  const certificates = ['/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'].find(existsSync);
  if (!certificates) throw new Error('System CA certificates are required for nginx tests');
  const config = template.replaceAll('${PORT}', `${port}`).replaceAll('${ARTIFACT_ORIGIN}', '').replaceAll('${ARTIFACT_RESOLVER}', '1.1.1.1').replace('/usr/share/nginx/html', new URL('dist', site).pathname).replace('/etc/ssl/cert.pem', certificates);
  await writeFile(join(dir, 'nginx.conf'), `daemon off; pid ${dir}/pid; error_log ${dir}/error.log; events {} http { client_body_temp_path ${dir}/body; proxy_temp_path ${dir}/proxy; fastcgi_temp_path ${dir}/fastcgi; uwsgi_temp_path ${dir}/uwsgi; scgi_temp_path ${dir}/scgi; types { text/html html; text/css css; application/javascript js; application/json json; image/webp webp; } ${config} }`);
  const process = spawn('nginx', ['-p', dir, '-c', join(dir, 'nginx.conf')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  process.stderr.on('data', (chunk) => { errors += chunk; });
  const request = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await request('/health')).status === 200) { ready = true; break; } } catch { /* Process is starting. */ }
      await Bun.sleep(40);
    }
    if (!ready) throw new Error(`nginx did not start: ${errors}`);
    for (const path of ['/', '/download', '/releases', '/releases/', '/roadmap', '/terms', '/privacy', '/dev', '/mockups', '/screenshots', '/scenes/custom']) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain("frame-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
      expect(await response.text()).toContain('<h1');
    }
    for (const path of ['/releases/channels.json', '/releases/1.2.3/artwork/test.png', '/ios', '/ios/releases/test/manifest.json']) expect((await request(path)).status).toBe(503);
    for (const locale of ['en', 'es', 'ja', 'ko', 'zh', 'fr', 'uk', 'ru', 'pl', 'de', 'pt']) {
      for (const suffix of ['', '/']) {
        const response = await request(`/${locale}${suffix}?private=discard`);
        expect(response.status).toBe(301); expect(response.headers.get('location')).toBe('/');
      }
      for (const page of ['download', 'roadmap', 'releases']) {
        const response = await request(`/${locale}/${page}?private=discard`);
        expect(response.status).toBe(301); expect(response.headers.get('location')).toBe(`/${page}`);
      }
      expect((await request(`/${locale}/esim/order/private-order?private=discard`)).status).toBe(410);
    }
    for (const path of ['/esim/checkout/private-invoice', '/esims', '/orders/private-order', '/order/private-order', '/blog/post', '/test-flows', '/fr/blog/post']) {
      const response = await request(path);
      expect(response.status).toBe(410); expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).not.toMatch(/script|private-invoice|private-order/);
    }
    const legal = await request('/legal/documents.json');
    expect(legal.headers.get('content-type')).toContain('application/json');
    expect(await legal.text()).toBe(await readFile(new URL('../copy/legal/documents.json', site), 'utf8'));
    expect((await request('/not-a-route')).status).toBe(404);
    expect((await request('/zz/download')).status).toBe(404);
    expect((await request('/_astro/missing.js')).status).toBe(404);
    expect((await request('/health')).status).toBe(200);
    const nostr = await request('/.well-known/nostr.json');
    expect(nostr.status).toBe(200);
    expect(nostr.headers.get('access-control-allow-origin')).toBe('*');
    expect(await nostr.json()).toEqual({ names: { _: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2', kelbie: 'c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81' } });
  } finally {
    process.kill('SIGQUIT');
    await new Promise<void>((resolve) => { if (process.exitCode !== null) resolve(); else process.once('exit', () => resolve()); });
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
