import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { localReleases } from './scripts/local-releases.mjs';
import { productionBoundary } from './scripts/production-boundary.mjs';
import { websiteCaptures } from './scripts/website-captures.mjs';

export default defineConfig({
  site: 'https://sovran.money',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [productionBoundary(), { name: 'sovran-local-workbench', hooks: {
    'astro:config:setup': async ({ command, updateConfig }) => {
      if (command === 'dev') {
        const { localArtwork } = await import('./scripts/local-artwork.mjs');
        updateConfig({ vite: { plugins: [localArtwork()] } });
      }
    },
  } }],
  vite: { envDir: './.no-env', plugins: [localReleases(), websiteCaptures()], define: {
    'import.meta.env.SOVRAN_REPO_ROOT': JSON.stringify(fileURLToPath(new URL('../', import.meta.url))),
  } },
});
