/**
 * Anti-drift gate for the e2e state mirror's store manifest: every store file
 * under the store directories whose module scope calls zustand's `create(`
 * must be registered in E2E_STORE_MANIFEST, so a newly added store can never
 * silently vanish from e2e state snapshots.
 *
 * Exclusions (helpers and per-call factories, documented in storeManifest.ts)
 * are explicit here so adding one is a reviewed decision.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APP_ROOT = join(__dirname, '..');

// Source-parsed rather than imported: importing the manifest would drag every
// store module (and their native transitive deps) into jest. The literal keys
// plus the type-checked Record<string, MirrorableStore> shape give the same
// guarantee without the dependency surface.
function manifestKeys(): Set<string> {
  const source = readFileSync(join(APP_ROOT, 'shared/lib/e2e/storeManifest.ts'), 'utf8');
  const body = source.split('E2E_STORE_MANIFEST')[1] ?? '';
  return new Set(Array.from(body.matchAll(/'([a-z]+\/[A-Za-z0-9]+)':/g), (m) => m[1]));
}

const STORE_DIRS: Record<string, string> = {
  global: 'shared/stores/global',
  profile: 'shared/stores/profile',
  runtime: 'shared/stores/runtime',
  bitchat: 'features/bitchat/stores',
  feed: 'features/feed/stores',
};

/** Files intentionally absent from the mirror. Every exclusion needs a durable
 * reason: either there is no enumerable store instance, or the state contains
 * plaintext secrets that must never enter debug artifacts. */
const EXCLUDED: ReadonlySet<string> = new Set([
  'global/migrateSettings',
  'profile/restoreActiveSessionView',
  'runtime/clearPaymentContext',
  'runtime/dmEchoStore', // DM bodies may be live bearer ecash tokens
  'runtime/legProgress', // factory: instances are created per call, not enumerable
]);

function storeFiles(): string[] {
  const found: string[] = [];
  for (const [scope, rel] of Object.entries(STORE_DIRS)) {
    for (const file of readdirSync(join(APP_ROOT, rel))) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const source = readFileSync(join(APP_ROOT, rel, file), 'utf8');
      // Module-level zustand hook: plain `create<...>(`/`create()(`, or a
      // module-level singleton built from the legProgress store factory.
      if (!/=\s*create(?:LegProgressStore)?[<(]/.test(source)) continue;
      found.push(`${scope}/${file.replace(/\.tsx?$/, '')}`);
    }
  }
  return found.sort();
}

describe('E2E_STORE_MANIFEST completeness', () => {
  it('registers every zustand store file (or lists it as an explicit exclusion)', () => {
    const keys = manifestKeys();
    expect(keys.size).toBeGreaterThan(30); // parse sanity: the regex found the literal
    const missing = storeFiles().filter((key) => !EXCLUDED.has(key) && !keys.has(key));
    expect(missing).toEqual([]);
  });

  it('has no stale manifest entries pointing at deleted stores', () => {
    const present = new Set(storeFiles());
    const stale = Array.from(manifestKeys()).filter((key) => !present.has(key));
    expect(stale).toEqual([]);
  });

  it('keeps every reviewed helper, factory, or sensitive store exclusion out', () => {
    const keys = manifestKeys();
    for (const key of EXCLUDED) expect(keys.has(key)).toBe(false);
  });

  it('never mirrors plaintext DM echoes that may contain bearer ecash tokens', () => {
    expect(manifestKeys()).not.toContain('runtime/dmEchoStore');
  });
});
