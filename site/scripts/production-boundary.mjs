import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC_ROUTES = {
  '/': 'index.astro', '/download': 'download.astro', '/releases': 'releases.astro',
  '/roadmap': 'roadmap.astro', '/[legal]': '[legal].astro', '/404': '404.astro',
  '/health': 'health.ts', '/build.json': 'build.json.ts', '/legal/documents.json': 'legal/documents.json.ts',
};
export const privateRoute = path => /^\/(?:dev|screenshots|logos|social|mockups|scenes[^/]*|__artwork)(?:\/|$)/.test(path);

export function productionBoundary() {
  let scratch;
  return { name: 'sovran-public-boundary', hooks: {
    'astro:config:setup': async ({ command, config, updateConfig, injectRoute }) => {
      if (command !== 'build') return;
      if (process.env.SOVRAN_INTERNAL_BUILD === '1') {
        updateConfig({ outDir: new URL('./.astro/internal-dist/', config.root) });
        return;
      }
      scratch = await mkdtemp(join(tmpdir(), 'sovran-public-'));
      const source = join(scratch, 'src'), assets = join(scratch, 'public');
      await mkdir(join(source, 'pages'), { recursive: true });
      const publicRoot = fileURLToPath(config.publicDir);
      await cp(publicRoot, assets, { recursive: true, dereference: false, filter: path => {
        const name = relative(publicRoot, path).replaceAll('\\', '/');
        if (!name) return true;
        if (name.split('/').some(part => part.startsWith('.') && part !== '.well-known')) return false;
        if (name === 'social' || name === 'social/og.png') return true;
        return !privateRoute(`/${name}`) && !name.startsWith('_astro/');
      } });
      // Astro's routes:resolved hook receives copies, not the mutable manifest.
      // Discover no source routes; inject public entrypoints before Vite sees them.
      updateConfig({ srcDir: pathToFileURL(`${source}/`), publicDir: pathToFileURL(`${assets}/`) });
      for (const [pattern, page] of Object.entries(PUBLIC_ROUTES)) injectRoute({
        pattern, entrypoint: fileURLToPath(new URL(`src/pages/${page}`, config.root)), prerender: true,
      });
    },
    'astro:build:done': async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); },
  } };
}
