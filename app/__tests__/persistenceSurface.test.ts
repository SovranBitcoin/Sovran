/**
 * @jest-environment node
 *
 * Everything the app writes to the phone outside a persisted store, recorded.
 *
 * A new persisted store turns the upgrade tests red, because they are driven by
 * the store registry. A new SecureStore key, an AsyncStorage key written by
 * hand, a new database name or a new version of a storage library used to turn
 * nothing red. This finds them in the source and compares them with
 * `fixtures/persistence-surface.json`.
 *
 * When it fails, the difference is the finding: something durable was added,
 * removed or re-versioned. Work through the `persistence-release-safety` skill
 * for it (can a phone on any earlier release still open?), then record the new
 * surface with:
 *
 *   cd app && WRITE_PERSISTENCE_SURFACE=1 bun run test -- __tests__/persistenceSurface.test.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..', '..');
const RECORD = join(__dirname, 'fixtures', 'persistence-surface.json');
const ROOTS = ['app', 'wallet/src', 'nostr/src'];
const SKIP_DIR =
  /^(node_modules|__tests__|__mocks__|e2e|codereview|ios|android|vendor|scripts|docs|\..*)$/;
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
const TEST_FILE = /\.test\./;

const STORAGE_LIBRARIES = [
  '@react-native-async-storage/async-storage',
  'expo-secure-store',
  'expo-sqlite',
  'expo-file-system',
  'zustand',
  '@cashu/coco-core',
  '@cashu/coco-expo-sqlite',
  '@cashu/coco-react',
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) sourceFiles(join(dir, entry.name), out);
    } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const ASYNC_STORAGE_CALL =
  /AsyncStorage\.(getItem|setItem|removeItem|mergeItem|multiGet|multiSet|multiRemove|multiMerge|getAllKeys|clear)\(\s*(?:(['"`])([^'"`]*)\2)?/g;
/** Directly, or through secureStorage.ts's helpers for a caller's own key. */
const SECURE_STORE_CALL =
  /(SecureStore\.(getItemAsync|setItemAsync|deleteItemAsync)|\b(read|write|delete)SensitiveValue)\(/;
const DATABASE_NAME = /(['"`])([A-Za-z0-9_${}.-]+\.db)\1/g;
const DATABASE_OPEN = /(openDatabase(Sync|Async)?|deleteDatabase(Sync|Async)?)\(/;
/** `KEY: 'value'` inside secureStorage.ts's STORAGE_KEYS, and the vault key prefix. */
const SECURE_KEY_CONSTANT = /^\s+[A-Z_]+: '([a-z0-9_]+)',$/gm;

function scan() {
  const asyncStorageFiles = new Set<string>();
  const asyncStorageKeys = new Set<string>();
  const secureStoreFiles = new Set<string>();
  const databaseFiles = new Set<string>();
  const databaseNames = new Set<string>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO, root))) {
      const text = readFileSync(file, 'utf8');
      const path = relative(REPO, file);
      for (const call of text.matchAll(ASYNC_STORAGE_CALL)) {
        asyncStorageFiles.add(path);
        if (call[3]) asyncStorageKeys.add(call[3]);
      }
      if (SECURE_STORE_CALL.test(text)) secureStoreFiles.add(path);
      if (DATABASE_OPEN.test(text)) databaseFiles.add(path);
      for (const name of text.matchAll(DATABASE_NAME)) databaseNames.add(name[2]);
    }
  }
  const secureStorage = readFileSync(join(REPO, 'app/shared/lib/nostr/secureStorage.ts'), 'utf8');
  const keys = secureStorage.slice(
    secureStorage.indexOf('const STORAGE_KEYS = {'),
    secureStorage.indexOf('} as const;')
  );
  const secureKeys = [...keys.matchAll(SECURE_KEY_CONSTANT)].map((match) => match[1]);

  const declared = (file: string) => {
    const json = JSON.parse(readFileSync(join(REPO, file), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return json.dependencies ?? {};
  };
  const dependencies = { ...declared('wallet/package.json'), ...declared('app/package.json') };
  const libraries = Object.fromEntries(
    STORAGE_LIBRARIES.filter((name) => dependencies[name]).map((name) => [name, dependencies[name]])
  );

  const sorted = (values: Iterable<string>) => [...values].sort();
  return {
    libraries,
    secureKeys: sorted(secureKeys),
    secureStoreFiles: sorted(secureStoreFiles),
    asyncStorageKeys: sorted(asyncStorageKeys),
    asyncStorageFiles: sorted(asyncStorageFiles),
    databaseNames: sorted(databaseNames),
    databaseFiles: sorted(databaseFiles),
  };
}

const found = scan();

if (process.env.WRITE_PERSISTENCE_SURFACE) {
  writeFileSync(RECORD, `${JSON.stringify(found, null, 2)}\n`);
}

const recorded = existsSync(RECORD)
  ? (JSON.parse(readFileSync(RECORD, 'utf8')) as ReturnType<typeof scan>)
  : null;

describe('what the app writes outside its persisted stores is the recorded surface', () => {
  it('has a record', () => {
    expect(recorded).not.toBeNull();
  });

  it.each(Object.keys(found) as (keyof typeof found)[])('%s', (part) => {
    expect(found[part]).toEqual(recorded?.[part]);
  });

  it('finds the things it is here to guard, so an empty scan cannot pass', () => {
    expect(found.secureKeys).toContain('user_mnemonic');
    expect(found.databaseNames.length).toBeGreaterThan(0);
    expect(found.asyncStorageFiles.length).toBeGreaterThan(5);
    expect(Object.keys(found.libraries)).toContain('expo-secure-store');
  });
});
