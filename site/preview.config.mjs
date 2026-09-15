import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { localReleases } from './scripts/local-releases.mjs';
import { localArtwork } from './scripts/local-artwork.mjs';

// Astro 5's preview discards user Vite middleware. Its static output is served
// by Vite directly here so local preview and dev share the metadata route.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  appType: 'mpa',
  envDir: './.no-env',
  build: { outDir: 'dist' },
  preview: { host: '127.0.0.1', port: 4321 },
  plugins: [localReleases(), localArtwork(), {
    name: 'sovran-static-page-paths',
    configurePreviewServer(server) {
      const output = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url, 'http://localhost');
        const candidate = resolve(output, `.${url.pathname}`, 'index.html');
        if (candidate.startsWith(`${output}${sep}`) && existsSync(candidate)) {
          request.url = `${url.pathname.replace(/\/$/, '')}/index.html${url.search}`;
        }
        next();
      });
    },
  }],
});
