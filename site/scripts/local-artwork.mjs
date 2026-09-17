import { fileURLToPath } from 'node:url';
import { buildSourceCatalog, readCaptureSource, readSourceFile, sha256 } from './source-catalog.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));

export function localArtwork({ repoRoot = repository } = {}) {
  let sources, catalogPending, busy = false;
  const sourceCatalog = () => catalogPending ??= buildSourceCatalog(repoRoot)
    .then(value => (sources = value)).finally(() => { catalogPending = undefined; });
  const middleware = async (request, response, next) => {
    const [route = '', query = ''] = (request.url || '').split('?');
    if (route !== '/__artwork' && !route.startsWith('/__artwork/')) return next();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const port = request.socket.localPort;
    const hosts = ['localhost', '127.0.0.1', '[::1]'].map(host => `${host}:${port}`);
    const host = request.headers.host, origin = request.headers.origin;
    if (!hosts.includes(host) || (origin !== undefined && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403); response.end(); return;
    }
    if (route === '/__artwork/render') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end(); return; }
      if (origin !== `http://${host}`) { response.writeHead(403); response.end(); return; }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') { response.writeHead(415); response.end(); return; }
      if (busy) { response.writeHead(429, { 'Retry-After': '1' }); response.end(); return; }
      if (Number(request.headers['content-length']) > 16384) { response.writeHead(413); response.end(); return; }
      busy = true;
      let timer;
      try {
        const body = await new Promise((resolveBody, reject) => {
          let size = 0;
          const chunks = [];
          timer = setTimeout(() => reject(Object.assign(new Error('Request timed out.'), { status: 408 })), 10000);
          request.on('data', chunk => {
            size += chunk.length;
            if (size > 16384) reject(Object.assign(new Error('Recipe exceeds 16 KiB.'), { status: 413 }));
            else chunks.push(chunk);
          });
          request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
          request.on('error', reject);
        });
        clearTimeout(timer);
        const { renderComposition, rasterize } = await import('./composition.mjs');
        // The SVG is the artwork; rasterizing is the expensive half and only an
        // export needs it, so a preview is served as the SVG a browser can draw.
        const result = await renderComposition(JSON.parse(body), { repoRoot, catalog: sources ?? await sourceCatalog() });
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(new URLSearchParams(query).get('format') === 'png'
          ? { png: (await rasterize(result.svg)).toString('base64'), provenance: result.provenance }
          : { svg: result.svg, provenance: result.provenance }));
      } catch (error) {
        response.writeHead(error.status ?? 422, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error instanceof SyntaxError ? 'Invalid recipe JSON.' : error.message }));
      } finally { clearTimeout(timer); busy = false; }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    try {
      if (route === '/__artwork/sources') {
        const value = await sourceCatalog();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
        return;
      }
      const match = /^\/__artwork\/image\/([a-f0-9]{64})$/.exec(route);
      if (!match) { response.writeHead(404); response.end(); return; }
      sources ||= await sourceCatalog();
      const source = [...sources.captures.filter(item => item.available), ...sources.logos.flatMap(item => item.outputs)]
        .find(item => item.sha256 === match[1]);
      if (!source) { response.writeHead(404); response.end(); return; }
      let bytes;
      try { bytes = source.id ? await readCaptureSource(repoRoot, source) : await readSourceFile(repoRoot, source.file); }
      catch { response.writeHead(409); response.end(); return; }
      if (sha256(bytes) !== source.sha256) { response.writeHead(409); response.end(); return; }
      response.setHeader('Content-Type', source.format === 'svg' ? 'image/svg+xml' : 'image/png');
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      response.setHeader('Content-Length', bytes.length);
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    }
  };
  return { name: 'sovran-local-artwork', apply: 'serve',
    configureServer(server) { server.middlewares.use(middleware); },
  };
}
