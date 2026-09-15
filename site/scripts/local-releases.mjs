import { fetchAvailability } from '../src/lib/releases.ts';

// Local servers need the same public metadata that production nginx proxies.
// Never forward local request headers, cookies, query strings, or credentials.
export function localReleases(fetcher = fetch) {
  const middleware = async (request, response, next) => {
    if (request.url?.split('?', 1)[0] !== '/releases/channels.json') return next();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }
    try {
      const channels = await fetchAvailability((_url, options) =>
        fetcher('https://sovran.money/releases/channels.json', options));
      response.statusCode = 200;
      response.setHeader('X-Sovran-Release-Source', 'https://sovran.money/releases/channels.json');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ schemaVersion: 1, channels }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: 'Public release metadata is unavailable' }));
    }
  };
  return {
    name: 'sovran-local-releases',
    apply: 'serve',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
