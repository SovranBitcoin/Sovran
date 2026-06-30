/**
 * @jest-environment node
 *
 * Regression guard for #212. The Wallet screen lives in the `(tabs)/index`
 * folder, which expo-router collapses to an empty path segment. Its canonical
 * route is therefore the app root `/` — navigating to `/(drawer)/(tabs)/index`
 * (a path the typed-routes generator emits but the runtime never mounts)
 * resolves to `+not-found`.
 *
 * This locks that behaviour against an in-memory mirror of the real tab
 * structure, so reverting the drawer's Wallet target back to the `index` path
 * (the original bug) fails here.
 */
import { inMemoryContext } from 'expo-router/build/testing-library/context-stubs';
import { getRoutes } from 'expo-router/build/getRoutes';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';

const Stub = () => null;

// Mirrors app/(drawer)/(tabs) with the wallet in an `index/` folder and a
// sibling `feed/` folder, plus the root `+not-found` catch-all.
const routeMap: Record<string, unknown> = {
  './_layout.tsx': Stub,
  './+not-found.tsx': Stub,
  './(drawer)/_layout.tsx': Stub,
  './(drawer)/(tabs)/_layout.tsx': {
    default: Stub,
    unstable_settings: { initialRouteName: 'index' },
  },
  './(drawer)/(tabs)/index/_layout.tsx': Stub,
  './(drawer)/(tabs)/index/index.tsx': Stub,
  './(drawer)/(tabs)/feed/_layout.tsx': Stub,
  './(drawer)/(tabs)/feed/index.tsx': Stub,
};

/** Strip expo-router's `_route` extension that react-navigation's validator rejects. */
function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '_route') continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return node;
}

type NavState = { routes?: { name: string; state?: unknown }[]; index?: number };

/** Leaf route-name chain for a resolved navigation state. */
function leafChain(state: unknown): string[] {
  const chain: string[] = [];
  let s: NavState | undefined = state as NavState;
  while (s?.routes) {
    const idx = s.index ?? s.routes.length - 1;
    const r = s.routes[idx];
    if (!r) break;
    chain.push(r.name);
    s = r.state as NavState | undefined;
  }
  return chain;
}

function resolve(path: string): string[] | undefined {
  const ctx = inMemoryContext(routeMap as never);
  const routeOptions = { internal_stripLoadRoute: true };
  const tree = getRoutes(ctx as never, routeOptions as never);
  const config = sanitize(getReactNavigationConfig(tree as never, false));
  const emptySegments: string[] = [];
  const state = getStateFromPath(path, config as never, emptySegments);
  return state ? leafChain(state) : undefined;
}

describe('wallet route resolution (#212)', () => {
  it('resolves the app root `/` to the wallet index screen', () => {
    expect(resolve('/')).toEqual(['(drawer)', '(tabs)', 'index', 'index']);
  });

  it('resolves the old `/(drawer)/(tabs)/index` target to +not-found (the bug)', () => {
    expect(resolve('/(drawer)/(tabs)/index')).toEqual(['+not-found']);
  });

  it('still resolves a normal sibling tab by its path', () => {
    expect(resolve('/(drawer)/(tabs)/feed')).toEqual(['(drawer)', '(tabs)', 'feed', 'index']);
  });
});
