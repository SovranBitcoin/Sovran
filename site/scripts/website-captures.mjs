import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceCatalog, readCaptureSource, readSourceFile } from './source-catalog.mjs';
import { resolveCapture } from './composition-recipe.mjs';
import { websiteScenes } from './website-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const moduleId = 'virtual:sovran-website-captures';

// Emit literal imports only for declared website scenes. A glob would let
// unselected QA images enter Astro's public asset graph even when never rendered.
export function websiteCaptures({ repoRoot = root } = {}) {
  let publicBuild = false;
  return { name: 'sovran-website-captures',
    configResolved(config) { publicBuild = config.command === 'build' && process.env.SOVRAN_INTERNAL_BUILD !== '1'; },
    resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
    async load(id) {
      if (id !== `\0${moduleId}`) return;
      const config = JSON.parse((await readSourceFile(repoRoot, 'press/website.json')).toString());
      const keys = [...new Set(Object.values(websiteScenes(config)).flatMap(scene => scene.screenshots))];
      const catalog = await buildSourceCatalog(repoRoot);
      const imports = [], entries = [];
      for (const file of ['press/website.json', 'press/artwork/source/screenshots.json', 'press/screenshots/manifest.json', 'press/screenshots/inventory.json']) this.addWatchFile(resolve(repoRoot, file));
      for (const [index, key] of keys.entries()) {
        const capture = resolveCapture(catalog, key);
        if (!capture?.available) throw new Error(`Website capture is missing or unapproved: ${key}`);
        if (publicBuild && catalog.fingerprint && capture.freshness !== 'current') throw new Error(`Website capture needs refresh: ${key}`);
        await readCaptureSource(repoRoot, capture);
        const file = resolve(repoRoot, capture.file);
        this.addWatchFile(file);
        imports.push(`import image${index} from ${JSON.stringify(file)};`);
        entries.push(`${JSON.stringify(key)}: { image: image${index}, sha256: ${JSON.stringify(capture.sha256)}, alt: ${JSON.stringify(capture.context.alt ?? capture.title)}, freshness: ${JSON.stringify(capture.freshness)} }`);
      }
      return `${imports.join('\n')}\nexport default {${entries.join(',\n')}};`;
    },
  };
}
