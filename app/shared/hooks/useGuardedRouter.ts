// eslint-disable-next-line no-restricted-imports -- The one adapter to Expo's imperative router; callers use guardedRouter or its explicit raw escape hatch.
import { router } from 'expo-router';
import { store as routerStore } from 'expo-router/build/global-state/router-store';

import { paymentLog } from '@/shared/lib/logger';

const COOLDOWN_MS = 600;

let lastNavAt = 0;
let lastSignature = '';

function signatureFor(href: unknown): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    try {
      return JSON.stringify(href, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]])
            )
          : value
      );
    } catch {
      return String(href);
    }
  }
  return String(href);
}

function shouldSuppress(signature: string): boolean {
  const now = Date.now();
  if (now - lastNavAt < COOLDOWN_MS && signature === lastSignature) {
    return true;
  }
  lastNavAt = now;
  lastSignature = signature;
  return false;
}

/** A path segment that only groups routes, like `(mint-flow)`. */
const isGroup = (segment: string) => segment.startsWith('(') && segment.endsWith(')');

type QueryEntry = [key: string, values: string[]];

/**
 * Params as `[key, values]` tuples sorted by key, each key's values in the
 * order given. Kept structured rather than joined back into a string, so an
 * encoded `&` or `=` inside one value never reads as a second param.
 */
function canonicalParams(pairs: [string, string][]): string {
  const byKey = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    const values = byKey.get(key);
    if (values) values.push(value);
    else byKey.set(key, [value]);
  }
  const entries: QueryEntry[] = [...byKey.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return JSON.stringify(entries);
}

/**
 * A query string as decoded `[key, value]` pairs. Parsed by hand: React
 * Native's `URLSearchParams` polyfill only promises `toString`, `get`, `has`.
 */
function queryPairs(query: string): [string, string][] {
  const decode = (part: string) => decodeURIComponent(part.replace(/\+/g, ' '));
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=');
      return at < 0 ? [decode(pair), ''] : [decode(pair.slice(0, at)), decode(pair.slice(at + 1))];
    });
}

/**
 * Whether `href` names the route that is focused right now: the same path once
 * dynamic segments are filled, `index` dropped and groups set aside, the same
 * search params, and every group it names among the focused route's groups
 * (so `/(map-flow)`, which is `/` too, is not the wallet home). Anything that
 * cannot be read answers false, so an unreadable href or router state never
 * blocks a navigation.
 */
function isFocusedRoute(href: unknown): boolean {
  try {
    const focused = routerStore.getRouteInfo();
    if (!focused) return false;
    let pathname: string;
    let pairs: [string, string][];
    if (typeof href === 'string') {
      const at = href.indexOf('?');
      pathname = at < 0 ? href : href.slice(0, at);
      pairs = at < 0 ? [] : queryPairs(href.slice(at + 1));
    } else if (
      href &&
      typeof href === 'object' &&
      typeof (href as { pathname?: unknown }).pathname === 'string'
    ) {
      const object = href as { pathname: string; params?: Record<string, unknown> };
      pathname = object.pathname;
      pairs = [];
      for (const [key, value] of Object.entries(object.params ?? {})) {
        if (value === undefined) continue;
        const dynamic = `[${key}]`;
        if (pathname.includes(dynamic)) pathname = pathname.replace(dynamic, String(value));
        else pairs.push([key, String(value)]);
      }
    } else {
      return false;
    }
    if (!pathname.startsWith('/') || pathname.includes('[')) return false;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.filter(isGroup).some((group) => !focused.segments.includes(group))) return false;
    const path = segments.filter((segment) => !isGroup(segment));
    if (path.at(-1) === 'index') path.pop();
    if (`/${path.join('/')}` !== focused.pathname) return false;
    return canonicalParams(pairs) === canonicalParams(queryPairs(focused.searchParams.toString()));
  } catch {
    return false;
  }
}

// Navigation methods that open / replace / dismiss a route get the double-tap
// cooldown. Every other property on `router` (canGoBack, canDismiss, setParams,
// reload, prefetch, …) passes straight through, so the guarded router is a
// complete drop-in for expo-router's `router`.
const GUARDED_METHODS = new Set([
  'push',
  'navigate',
  'replace',
  'back',
  'dismiss',
  'dismissAll',
  'dismissTo',
]);

/** A complete `router` plus `raw` (the unwrapped router, for the rare case guarding is undesirable). */
type GuardedRouter = typeof router & { raw: typeof router };

function createGuardedRouter(target: typeof router): GuardedRouter {
  return new Proxy(target as object, {
    get(t, prop, receiver) {
      if (prop === 'raw') return t;
      const value = Reflect.get(t, prop, receiver);
      if (typeof prop === 'string' && GUARDED_METHODS.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => {
          const signature = `${prop}:${args.map(signatureFor).join(',')}`;
          if (shouldSuppress(signature)) {
            paymentLog.debug('navigation.guard.suppressed', { method: prop });
            return undefined;
          }
          // A screen that mounts slowly outlives the cooldown: a second tap
          // would stack a copy of the screen the first tap already focused.
          if (prop === 'push' && isFocusedRoute(args[0])) {
            paymentLog.debug('navigation.guard.suppressed', { method: prop, reason: 'focused' });
            return undefined;
          }
          return (value as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  }) as GuardedRouter;
}

/**
 * Debounced drop-in for expo-router's `router`. Suppresses repeated navigation
 * calls with the same destination within a short cooldown so a double-tap on a
 * button cannot push the same modal twice, and a `push` of the route that is
 * already focused however late it comes. Use it anywhere a Pressable's
 * `onPress` opens a route — either via this hook (`const router =
 * useGuardedRouter()`) or the imperative `guardedRouter` (for non-React
 * modules / `import { guardedRouter as router }`).
 */
export const guardedRouter: GuardedRouter = createGuardedRouter(router);

export function useGuardedRouter(): GuardedRouter {
  // Module singleton — referentially stable across renders, so it is safe in
  // dependency arrays and as a `router` substitute.
  return guardedRouter;
}
