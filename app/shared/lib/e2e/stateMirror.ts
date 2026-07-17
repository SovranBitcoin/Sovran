/**
 * Dev-gated e2e state mirror: subscribes to every store in the manifest and
 * writes a debounced full-state snapshot to `Documents/e2e/state.json` inside
 * the app container, where the e2e harness reads it beside each screenshot
 * frame (see e2e/drivers/app-data.ts).
 *
 * The write is atomic (tmp file + moveSync) so the harness can never observe a
 * torn snapshot. Runs ONLY when the harness-owned Metro sets
 * EXPO_PUBLIC_E2E_STATE_MIRROR — never in an ordinary dev session, never in
 * production (`__DEV__` gate), never on web. The snapshot stays inside the
 * app's own sandbox; zustand never holds seeds or private keys (SecureStore
 * does), and the same container already holds the unencrypted coco.db.
 */
import { Platform } from 'react-native';

import { E2E_STORE_MANIFEST } from './storeManifest';

type ExpoFileSystem = typeof import('expo-file-system');

const MIRROR_DIR = 'e2e';
const MIRROR_FILE = 'state.json';
const TMP_FILE = 'state.json.tmp';
const DEBOUNCE_MS = 250;

export function isStateMirrorEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_E2E_STATE_MIRROR === '1' && Platform.OS !== 'web';
}

/**
 * JSON.stringify replacer making arbitrary store state serializable: drops
 * functions, tags Map/Set, stringifies BigInt, flattens Error. Circular
 * references are broken per-flush by the factory's seen-set.
 */
export function createSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'function') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Map) return { __type: 'Map', entries: Array.from(value.entries()) };
    if (value instanceof Set) return { __type: 'Set', values: Array.from(value.values()) };
    if (value instanceof Error) return { __type: 'Error', message: value.message };
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/** Giant cache stores (e.g. the BTC Map merchant dataset, ~5 MB) would make
 * every flush a multi-MB JS-thread stringify + disk write and distort the app
 * under test; past this cap a store serializes to a Truncated marker. */
const MAX_STORE_BYTES = 256 * 1024;

/** Serialize one store's state to a JSON fragment, capped. Exported for tests. */
export function serializeStoreFragment(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value, createSafeReplacer()) ?? 'null';
  } catch (error) {
    return JSON.stringify({ __type: 'Error', message: (error as Error).message });
  }
  if (json.length <= MAX_STORE_BYTES) return json;
  const keys =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value as object)
      : [];
  return JSON.stringify({
    __type: 'Truncated',
    bytes: json.length,
    note: `store serialization exceeds the ${MAX_STORE_BYTES / 1024}KB mirror cap`,
    keys,
  });
}

/** Per-state-reference fragment cache: zustand replaces the state object on
 * every set(), so reference identity ⇒ unchanged content — a flush only pays
 * stringify cost for the stores that actually changed since the last one. */
const fragmentCache = new WeakMap<object, string>();

/** Serialize one full snapshot by assembling cached per-store fragments. */
export function serializeSnapshot(revision: number, capturedAt: number): string {
  const parts: string[] = [];
  for (const [name, store] of Object.entries(E2E_STORE_MANIFEST)) {
    let fragment: string;
    try {
      const value = store.getState();
      if (value !== null && typeof value === 'object') {
        const cached = fragmentCache.get(value);
        if (cached === undefined) {
          fragment = serializeStoreFragment(value);
          fragmentCache.set(value, fragment);
        } else {
          fragment = cached;
        }
      } else {
        fragment = serializeStoreFragment(value);
      }
    } catch (error) {
      fragment = JSON.stringify({ __type: 'Error', message: (error as Error).message });
    }
    parts.push(`${JSON.stringify(name)}:${fragment}`);
  }
  return `{"v":1,"revision":${revision},"capturedAt":${capturedAt},"stores":{${parts.join(',')}}}`;
}

/**
 * Start mirroring. Returns a teardown that unsubscribes and cancels any
 * pending flush. Callers gate on `isStateMirrorEnabled()`.
 */
export function startStateMirror(): () => void {
  let fs: ExpoFileSystem;
  try {
    fs = require('expo-file-system') as ExpoFileSystem;
  } catch {
    return () => {};
  }

  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (stopped) return;
    try {
      const payload = serializeSnapshot(++revision, Date.now());
      const dir = new fs.Directory(fs.Paths.document, MIRROR_DIR);
      if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
      const tmp = new fs.File(dir, TMP_FILE);
      if (tmp.exists) tmp.delete();
      tmp.create();
      tmp.write(payload);
      const target = new fs.File(dir, MIRROR_FILE);
      if (target.exists) target.delete();
      tmp.moveSync(target);
    } catch {
      // Best-effort evidence — never let mirroring break the app under test.
    }
  };

  const schedule = () => {
    if (stopped || timer !== null) return;
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  const unsubscribes = Object.values(E2E_STORE_MANIFEST).map((store) => {
    try {
      return store.subscribe(schedule);
    } catch {
      return () => {};
    }
  });

  // Immediate initial flush so the launch frame already has a snapshot.
  flush();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch {
        // teardown is best-effort
      }
    }
  };
}
