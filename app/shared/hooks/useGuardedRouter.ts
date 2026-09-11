// eslint-disable-next-line no-restricted-imports -- The one adapter to Expo's imperative router; callers use guardedRouter or its explicit raw escape hatch.
import { router } from 'expo-router';

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
 * button cannot push the same modal twice. Use it anywhere a Pressable's
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

/** Reset the cooldown gate. Test-only. */
export function __resetGuardForTests(): void {
  lastNavAt = 0;
  lastSignature = '';
}
