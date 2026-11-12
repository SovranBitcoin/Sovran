import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  appleHistory,
  catalogSchema,
  easBuilds,
  githubReleases,
  pipelineReleases,
  retainHistory,
  type ReleaseCatalog,
} from './releases';

const gh = (...args: string[]): unknown =>
  JSON.parse(
    execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  );
const refSchema = z.object({ object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) });
const treeSchema = z.object({ tree: z.array(z.object({ path: z.string(), type: z.string() })) });
const contentSchema = z.object({ content: z.string(), encoding: z.literal('base64') });

/** Explicit GET-only refresh. Normal tests never need network or credentials. */
export async function refreshCatalog(
  root: string,
  previous?: ReleaseCatalog
): Promise<ReleaseCatalog> {
  const appStoreURL = 'https://apps.apple.com/gb/app/sovran/id6499554529';
  const response = await fetch(appStoreURL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Apple history: HTTP ${response.status}`);
  const apple = appleHistory(await response.text());
  const repo = 'SovranBitcoin/Sovran';
  const revision = refSchema.parse(gh(`repos/${repo}/git/ref/heads/release-state`)).object.sha;
  const files = treeSchema
    .parse(gh(`repos/${repo}/git/trees/${revision}?recursive=1`))
    .tree.filter(
      (entry) => entry.type === 'blob' && /^(active\.json|history\/[^/]+\.json)$/.test(entry.path)
    );
  if (!files.some((entry) => entry.path === 'active.json') || files.length > 200)
    throw new Error('Unexpected release-state tree');
  const pipeline = files.flatMap(({ path }) => {
    const file = contentSchema.parse(gh(`repos/${repo}/contents/${path}?ref=${revision}`));
    const value: unknown = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    return pipelineReleases(value, `${revision}/${path}`);
  });
  const pages = z
    .array(z.array(z.unknown()))
    .parse(gh('--paginate', '--slurp', `repos/${repo}/releases?per_page=100`));
  const github = githubReleases(pages.flat());
  const eas = easBuilds(
    readFileSync(join(root, 'docs/architecture/persistence/store-builds.tsv'), 'utf8')
  );
  return catalogSchema.parse({
    schema: 1,
    observedAt: new Date().toISOString(),
    sources: [
      {
        source: appStoreURL,
        scope: 'Public GB iOS version history',
        limitation:
          'Public history may be incomplete; no build numbers or commit IDs. Earlier observations are retained.',
      },
      {
        source: `https://github.com/${repo}/tree/${revision}`,
        scope: 'Per-channel pipeline confirmations',
        limitation: 'Retired or empty-channel states do not prove non-publication.',
      },
      {
        source: `https://github.com/${repo}/releases`,
        scope: 'Published non-prerelease GitHub releases and APK assets',
        limitation: 'A release without an APK does not prove Android distribution.',
      },
      {
        source: 'docs/architecture/persistence/store-builds.tsv',
        scope: 'Conservative installable EAS build inventory',
        limitation:
          'Finished store builds do not establish public rollout. Refresh separately with epochs.py builds.',
      },
      {
        source: 'https://play.google.com/store/apps/details?id=com.sovranbitcoin',
        scope:
          'Android history comes from confirmed pipeline releases, APK evidence and installable builds',
        limitation:
          'No complete public Play release history is available. Version codes are not inferred from release notes; the page was not scraped by this collector.',
      },
    ],
    observations: retainHistory(previous?.observations ?? [], [
      ...apple,
      ...pipeline,
      ...github,
      ...eas,
    ]),
  });
}
export function saveCatalog(file: string, catalog: ReleaseCatalog) {
  const temporary = `${file}.pending`;
  writeFileSync(temporary, `${JSON.stringify(catalogSchema.parse(catalog), null, 2)}\n`);
  renameSync(temporary, file);
}
