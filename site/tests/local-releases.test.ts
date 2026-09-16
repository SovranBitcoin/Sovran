import { expect, test } from 'bun:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { localReleases } from '../scripts/local-releases.mjs';
import { preview } from 'vite';
import previewConfig from '../preview.config.mjs';

const fixture = {
  schemaVersion: 1,
  channels: {
    appStore: { version: '0.1.3', build: '176', url: 'https://apps.apple.com/app/id6499554529' },
    freedomStore: { version: '0.1.0', build: '169', url: 'https://freedomstore.io' },
    googlePlay: null,
    githubApk: { version: '0.1.3', build: '24', url: 'https://github.com/SovranBitcoin/Sovran/releases/download/v0.1.3/sovran-0.1.3.apk' },
    zapstore: { version: '0.1.3', build: '24', url: 'https://zapstore.dev/apps/com.sovranbitcoin' },
  },
};

test('the actual preview server resolves Astro directory pages without an SPA fallback', async () => {
  const server = await preview({ ...previewConfig, configFile: false, preview: { host: '127.0.0.1', port: 0 } });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No preview address');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ['/', '/download', '/releases', '/terms', '/privacy']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toContain('text/html');
    }
    expect((await fetch(`${origin}/missing-page`)).status).toBe(404);
    for (const path of ['/dev', '/screenshots', '/logos', '/social', '/mockups', '/scenes/hero', '/__artwork/catalog']) expect((await fetch(`${origin}${path}`)).status).toBe(404);
  } finally { await server.close(); }
});

for (const hook of ['configureServer', 'configurePreviewServer'] as const) {
  test(`${hook} supplies public channel data without leaking local requests or retaining stale success`, async () => {
    let fail = false;
    const calls: { url: string; options: RequestInit }[] = [];
    const plugin = localReleases(async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return fail ? new Response('offline', { status: 503 }) : Response.json(fixture);
    });
    let middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
    plugin[hook]({ middlewares: { use(handler: typeof middleware) { middleware = handler; } } });
    const server = createServer((request, response) => void middleware(request, response, () => {
      response.writeHead(404).end();
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const result = await fetch(`${url}/releases/channels.json?local-secret=never-forward`, {
        headers: { Authorization: 'local-only', Cookie: 'local-only', Referer: 'http://localhost/private' },
      });
      expect(result.status).toBe(200);
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.headers.get('content-type')).toBe('application/json');
      expect(await result.json()).toEqual(fixture);
      expect(calls[0].url).toBe('https://sovran.money/releases/channels.json');
      expect(calls[0].options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
      expect(calls[0].options.headers).toBeUndefined();
      expect((await fetch(`${url}/releases`)).status).toBe(404);
      expect((await fetch(`${url}/releases/channels.json/extra`)).status).toBe(404);
      expect((await fetch(`${url}/releases/channels.json`, { method: 'POST', body: 'not forwarded' })).status).toBe(405);
      expect(calls).toHaveLength(1);
      const head = await fetch(`${url}/releases/channels.json`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      fail = true;
      const unavailable = await fetch(`${url}/releases/channels.json`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.text()).not.toContain('0.1.3');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}
