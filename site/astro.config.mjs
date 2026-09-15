import { defineConfig } from 'astro/config';
import { localReleases } from './scripts/local-releases.mjs';
import { localArtwork } from './scripts/local-artwork.mjs';

export default defineConfig({
  site: 'https://sovran.money',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'never' },
  vite: { envDir: './.no-env', plugins: [localReleases(), localArtwork()] },
});
