/* eslint-disable import/first */

/**
 * Persisted enum/literal TOLERANCE guard.
 *
 * `createMergeWithSchema` is all-or-nothing: one field that fails parse
 * discards the entire blob and the store silently falls back to in-memory
 * defaults. The values most likely to fail that way are the ones whose legal
 * SET changes between builds — enums and literals. A member added in a later
 * version and read back by an earlier one, or a member retired while a blob
 * still holds it, wipes the store. That is exactly how `settingsStore` lost
 * terms acceptance and onboarding state once (AGENTS.md persisted-schema
 * invariant), and it is why the house rule is `.catch(D)` where a neutral
 * member exists and a tolerant collection where one does not.
 *
 * `skills/sovran-deslop/rules/persisted-enum-needs-catch.yml` enforces this
 * syntactically, but it matches `z.enum(...)` text inside store-file globs, so
 * it cannot see:
 *   - an enum imported from elsewhere (`ThemeMode` from
 *     `@sovranbitcoin/schemas`, `ConnectionStatusSchema` from
 *     `features/nostrSigner/lib/nip46Types.ts`), which its own `note` admits;
 *   - `z.literal(...)`, which it does not match at all.
 * It reported this class at zero while eleven such fields were unprotected.
 *
 * This walks the registered schemas themselves, so where a value came from
 * stops mattering. A field is protected when a `.catch(...)` sits anywhere
 * above it — including the one `tolerantRecord`/`tolerantArray` put around
 * each entry, which is why a contained collection's enums do not appear here.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ normalizeRelayUrl: (url: string) => url }), {
  virtual: true,
});

import '@/features/bitchat/stores/bitchatDmMessages';
import '@/features/feed/stores/ignoreStore';
import '@/features/feed/stores/notificationPolicyStore';
import '@/features/nostrSigner/data/nip46ActivityStore';
import '@/features/nostrSigner/data/nip46ConnectionsStore';
import '@/shared/lib/nostr/media/mediaServerStore';
import '@/shared/lib/nostr/outbox/relayListStore';
import '@/shared/stores/global/btcMapStore';
import '@/shared/stores/global/mempoolAddressCache';
import '@/shared/stores/global/mintMetadataStore';
import '@/shared/stores/global/nostrMetadataCache';
import '@/shared/stores/global/pricelistStore';
import '@/shared/stores/global/profileStore';
import '@/shared/stores/global/relayMetadataStore';
import '@/shared/stores/global/settingsStore';
import '@/shared/stores/global/walletLifecycleStore';
import '@/shared/stores/global/wallpaperStore';
import '@/shared/stores/profile/dataMigrationStore';
import '@/shared/stores/profile/mintDistributionStore';
import '@/shared/stores/profile/mintStore';
import '@/shared/stores/profile/nostrSocialStore';
import '@/shared/stores/profile/npcMintStore';
import '@/shared/stores/profile/nutDropRedeemQueueStore';
import '@/shared/stores/profile/ownContentStore';
import '@/shared/stores/profile/ownedMediaStore';
import '@/shared/stores/profile/recentPeopleStore';
import '@/shared/stores/profile/routstrStore';
import '@/shared/stores/profile/scanHistoryStore';
import '@/shared/stores/profile/searchHistoryStore';
import '@/shared/stores/profile/sendReachabilityStore';
import '@/shared/stores/profile/swapTransactionsStore';
import '@/shared/stores/profile/themeStore';
import '@/shared/stores/profile/transactionAnnotationStore';
import '@/shared/stores/profile/transactionDistributionStore';
import '@/shared/stores/profile/transactionLocationStore';

import { z } from 'zod';

import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

/**
 * Fields allowed to reject a blob outright. Every entry needs the reason, the
 * same way the ast-grep rule wants an `ast-grep-ignore` comment: an unprotected
 * persisted enum is a data-loss decision, not an oversight to be waived.
 *
 * Empty today. Reach for a tolerant collection before adding to it — dropping
 * the row a value cannot be trusted in keeps the blob AND fails closed.
 */
const ALLOWED_TO_REJECT: Record<string, string> = {};

interface ZodNode {
  _zod?: { def?: Record<string, unknown> };
}

/**
 * Node types that hold no nested schema, so reaching one ends that branch.
 * Anything not listed here and not descended into below is reported as
 * `unhandled(...)` rather than skipped: a walker that silently stops is a
 * walker that reports clean, which is the failure mode this whole file is
 * about.
 */
const LEAF_TYPES = new Set([
  'any',
  'bigint',
  'boolean',
  'custom',
  'date',
  'file',
  'int',
  'nan',
  'never',
  'null',
  'number',
  'string',
  'symbol',
  'transform',
  'undefined',
  'unknown',
  'void',
]);

/** Collect every enum/literal reachable without passing through a `.catch()`. */
function unprotectedValueSets(root: unknown, rootPath: string): string[] {
  const found: string[] = [];
  // Keyed by node AND protection state. Keying by node alone would let a
  // schema instance reused in two places — `const E = z.enum([...])` used once
  // as `E.catch('a')` and once bare — be marked seen on the protected visit
  // and skipped on the bare one.
  const seen = new Map<unknown, Set<boolean>>();

  const walk = (node: unknown, path: string, caught: boolean): void => {
    if (!node || typeof node !== 'object') return;
    const states = seen.get(node);
    if (states?.has(caught)) return;
    if (states) states.add(caught);
    else seen.set(node, new Set([caught]));

    const def = (node as ZodNode)._zod?.def;
    if (!def) return;
    const type = def.type as string;

    switch (type) {
      // `.catch()` rescues an INVALID value; `.default()` only rescues a
      // MISSING one, which is not the wipe class.
      case 'catch':
        walk(def.innerType, path, true);
        return;
      case 'default':
      case 'prefault':
      case 'optional':
      case 'nullable':
      case 'nonoptional':
      case 'readonly':
      case 'success':
      case 'promise':
        walk(def.innerType, path, caught);
        return;
      case 'enum':
      case 'literal':
        if (!caught) found.push(path);
        return;
      case 'object':
        for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
          walk(child, `${path}.${key}`, caught);
        }
        walk(def.catchall, `${path}.*`, caught);
        return;
      case 'array':
        walk(def.element, `${path}[]`, caught);
        return;
      case 'record':
      case 'map':
        // A key schema rejects just as hard as a value schema does.
        walk(def.keyType, `${path}{key}`, caught);
        walk(def.valueType, `${path}{}`, caught);
        return;
      case 'set':
        walk(def.valueType, `${path}<>`, caught);
        return;
      case 'union':
        (def.options as unknown[]).forEach((option, i) => walk(option, `${path}|${i}`, caught));
        return;
      case 'intersection':
        walk(def.left, path, caught);
        walk(def.right, path, caught);
        return;
      case 'tuple':
        (def.items as unknown[]).forEach((item, i) => walk(item, `${path}[${i}]`, caught));
        walk(def.rest, `${path}[...]`, caught);
        return;
      case 'pipe':
        // Both halves parse. `.transform()` puts the function in `out`, which
        // is a leaf; a `z.pipe(a, b)` puts a real schema there.
        walk(def.in, path, caught);
        walk(def.out, path, caught);
        return;
      case 'lazy':
        walk((def.getter as () => unknown)(), path, caught);
        return;
      case 'template_literal':
        // `parts` interleaves literal strings with schemas; only the latter
        // can reject. `z.templateLiteral([z.enum(['user']), ':', z.string()])`
        // is as capable of failing a blob as a bare field is.
        (def.parts as unknown[]).forEach((part, i) => walk(part, `${path}\`${i}\``, caught));
        return;
      default:
        if (!LEAF_TYPES.has(type)) found.push(`${path} :: unhandled(${type})`);
        return;
    }
  };

  walk(root, rootPath, false);
  return found;
}

const APP_DIR = resolve(__dirname, '..');

/**
 * Files that call `persistConfig` but register no fixed store name, so they
 * cannot be imported above. Mirrors `persistRoundTrip`'s list.
 */
const NOT_A_CONCRETE_STORE = ['shared/lib/cache/createQueryCacheStore.ts'];

/** Every file that calls `persistConfig`, from the source tree. */
function persistConfigCallSites(): string[] {
  const hits: string[] = [];
  const skip = new Set(['node_modules', 'ios', 'android', '__tests__', 'e2e', '.expo']);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        const source = readFileSync(full, 'utf8');
        // The import specifier, not just the call: a store that imported
        // `persistConfig as registerStore` would evade a call-shape match and
        // never be walked.
        if (/from '@\/shared\/lib\/persist\/persistConfig'/.test(source)) {
          hits.push(relative(APP_DIR, full));
        }
      }
    }
  };
  walk(APP_DIR);
  return hits.sort();
}

describe('persisted enum tolerance', () => {
  it('inspects every persistConfig caller in the source tree', () => {
    // The import list above is a second copy of the one `persistRoundTrip`
    // keeps. Without this, a store added there and forgotten here would never
    // be walked — and would report clean for the same reason the ast-grep rule
    // does: nothing looked.
    const registered = new Set(persistRegistry.map((entry) => entry.name));
    const missing = persistConfigCallSites()
      .filter((file) => !file.endsWith('persist/persistConfig.ts'))
      .filter((file) => !NOT_A_CONCRETE_STORE.includes(file))
      .filter((file) => {
        const source = readFileSync(join(APP_DIR, file), 'utf8');
        const names = [
          ...source.matchAll(
            /persistConfig\s*(?:<[^>]*>)?\s*\(\s*\{[\s\S]{0,400}?name:\s*'([^']+)'/g
          ),
        ].map((match) => match[1] as string);
        return names.length === 0 || names.some((name) => !registered.has(name));
      });
    expect(missing).toEqual([]);
  });

  it('walks a schema the registry actually holds', () => {
    // Guards the walker itself: if it silently stopped descending, every
    // assertion below would pass by finding nothing.
    const social = persistRegistry.find((e) => e.name === 'nostr-social-store');
    expect(social).toBeDefined();
    expect(unprotectedValueSets(social!.schema, 'probe')).toEqual([]);
    const contrived = z.object({ a: z.enum(['x', 'y']) });
    expect(unprotectedValueSets(contrived, 'probe')).toEqual(['probe.a']);
  });

  it('does not let one protected use of a shared enum mask a bare one', () => {
    // The same schema INSTANCE reused twice. Deduping by node alone marks it
    // seen on the protected visit and never inspects the bare one.
    const shared = z.enum(['x', 'y']);
    const schema = z.object({ safe: shared.catch('x'), unsafe: shared });
    expect(unprotectedValueSets(schema, 'probe')).toEqual(['probe.unsafe']);
  });

  it('reaches the shapes a persisted blob can also be rejected by', () => {
    // Record keys, object catchalls, tuple rests and both halves of a pipe
    // reject exactly as hard as a named field does.
    expect(unprotectedValueSets(z.record(z.enum(['k1', 'k2']), z.string()), 'p')).toEqual([
      'p{key}',
    ]);
    expect(unprotectedValueSets(z.object({}).catchall(z.enum(['c'])), 'p')).toEqual(['p.*']);
    expect(unprotectedValueSets(z.tuple([z.string()], z.enum(['r'])), 'p')).toEqual(['p[...]']);
    expect(unprotectedValueSets(z.set(z.enum(['s'])), 'p')).toEqual(['p<>']);
    // A template literal interleaves literal strings with schemas; the schema
    // parts reject a blob exactly as a bare field does.
    expect(
      unprotectedValueSets(z.templateLiteral([z.enum(['user', 'admin']), ':', z.string()]), 'p')
    ).toEqual(['p`0`']);
  });

  it('reports a node type it does not understand instead of skipping it', () => {
    // Fail closed: a Zod version that introduces a new container must be
    // classified here, not silently walked past.
    const alien = { _zod: { def: { type: 'brand-new-container' } } };
    expect(unprotectedValueSets(alien, 'p')).toEqual(['p :: unhandled(brand-new-container)']);
  });

  it('leaves no persisted enum or literal able to discard its blob', () => {
    const violations = persistRegistry
      .flatMap((entry) => unprotectedValueSets(entry.schema, entry.name))
      .filter((path) => !ALLOWED_TO_REJECT[path])
      .sort();
    expect(violations).toEqual([]);
  });

  it('keeps the exemption list free of entries that no longer apply', () => {
    const live = new Set(
      persistRegistry.flatMap((entry) => unprotectedValueSets(entry.schema, entry.name))
    );
    const stale = Object.keys(ALLOWED_TO_REJECT).filter((path) => !live.has(path));
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Containment — the property the guard above exists to protect.
// ---------------------------------------------------------------------------

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

/** The store's in-memory state, typed at the call site without an assertion. */
function current<T extends object>(state: T): T {
  return state;
}

/** Run a blob through the real persist `merge` for a registered store. */
function merge<T extends object>(storeName: string, persisted: unknown, current: T): T {
  const entry = persistRegistry.find((e) => e.name === storeName);
  if (!entry) throw new Error(`store not registered: ${storeName}`);
  return createMergeWithSchema(storeName, entry.schema)(persisted, current);
}

function connection(clientPubkey: string, overrides: Record<string, unknown> = {}) {
  return {
    clientPubkey,
    relays: ['wss://relay.example.com'],
    origin: 'bunker',
    status: 'active',
    mode: 'standard',
    encryption: 'nip44',
    pairedAt: 1,
    requestCount: 0,
    deniedCount: 0,
    grants: {},
    peerDecryptGrants: {},
    previousClientPubkeys: [],
    ...overrides,
  };
}

describe('persisted rejection is contained to the row', () => {
  it('keeps every other pairing when one connection carries an unknown value', () => {
    // The reason this matters: `encryption` is a security semantic with no
    // neutral member, so an unrecognized one must not be guessed — but bare,
    // `z.record` rejected the whole map for it and the user lost EVERY paired
    // app, not the one the blob could not be trusted about.
    const merged = merge(
      'nip46-connections-store',
      {
        apps: {
          [PUBKEY_A]: connection(PUBKEY_A),
          [PUBKEY_B]: connection(PUBKEY_B, { encryption: 'nip17-from-a-later-build' }),
        },
      },
      current<{ apps: Record<string, unknown> }>({ apps: {} })
    );
    expect(Object.keys(merged.apps)).toEqual([PUBKEY_A]);
  });

  it('keeps the activity log when one entry carries an unknown method', () => {
    const merged = merge(
      'nip46-activity-store',
      {
        entries: [
          {
            id: '1',
            clientPubkey: PUBKEY_A,
            method: 'sign_event',
            verdict: 'approved_once',
            at: 3,
          },
          {
            id: '2',
            clientPubkey: PUBKEY_A,
            method: 'nip44_encrypt_v2',
            verdict: 'approved_once',
            at: 2,
          },
          { id: '3', clientPubkey: PUBKEY_A, method: 'ping', verdict: 'denied_once', at: 1 },
        ],
      },
      current<{ entries: { id: string }[] }>({ entries: [] })
    );
    expect(merged.entries.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('keeps the follow set and the rest of the social blob when one value is not true', () => {
    const merged = merge(
      'nostr-social-store',
      {
        contactsTags: [['p', PUBKEY_A]],
        contactsUpdatedAt: 42,
        followingPubkeys: { [PUBKEY_A]: true, [PUBKEY_B]: false },
      },
      current<{
        contactsTags: string[][];
        contactsUpdatedAt: number;
        followingPubkeys: Record<string, true>;
      }>({ contactsTags: [], contactsUpdatedAt: 0, followingPubkeys: {} })
    );
    expect(Object.keys(merged.followingPubkeys)).toEqual([PUBKEY_A]);
    expect(merged.contactsUpdatedAt).toBe(42);
    expect(merged.contactsTags).toEqual([['p', PUBKEY_A]]);
  });

  it('keeps the theme blob when mode is a member this build does not know', () => {
    const merged = merge(
      'theme-store',
      { activeAlbumSlug: 'clay', unitWallpapers: { sat: 'dusk' }, mode: 'system' },
      current<{
        activeAlbumSlug: string | null;
        unitWallpapers: Record<string, string>;
        mode: string;
      }>({ activeAlbumSlug: null, unitWallpapers: {}, mode: 'dark' })
    );
    expect(merged.mode).toBe('dark');
    expect(merged.activeAlbumSlug).toBe('clay');
    expect(merged.unitWallpapers).toEqual({ sat: 'dusk' });
  });

  it('drops the entry, not the record, when a KEY fails its schema', () => {
    // `z.record(keySchema, …)` validates keys before the transform runs, so a
    // malformed key used to reject the whole record — and with it the store.
    const schema = tolerantRecord(z.string().max(4), z.object({ n: z.number() }));
    const parsed = schema.safeParse({ ok: { n: 1 }, waytoolong: { n: 2 } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ ok: { n: 1 } });
  });
});
