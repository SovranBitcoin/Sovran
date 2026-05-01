import { useMemo } from 'react';
import { router, type Href } from 'expo-router';

import { paymentLog } from '@/shared/lib/logger';

const COOLDOWN_MS = 600;

let lastNavAt = 0;
let lastSignature = '';

function signatureFor(href: unknown): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    try {
      return JSON.stringify(href);
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

export interface GuardedRouter {
  push: (typeof router)['push'];
  navigate: (typeof router)['navigate'];
  replace: (typeof router)['replace'];
  back: (typeof router)['back'];
  dismiss: (typeof router)['dismiss'];
  dismissAll: (typeof router)['dismissAll'];
  dismissTo: (typeof router)['dismissTo'];
  /** The unwrapped router for cases where guarding is undesirable. */
  raw: typeof router;
}

/**
 * Debounced wrapper around expo-router's `router`. Suppresses repeated calls
 * with the same destination within a short cooldown so a double-tap on a
 * button does not push the same modal twice. Use everywhere a Pressable's
 * `onPress` calls into `router.push` / `router.navigate` to open a modal
 * route.
 */
export function useGuardedRouter(): GuardedRouter {
  return useMemo<GuardedRouter>(
    () => ({
      raw: router,
      push: ((href: Href) => {
        if (shouldSuppress(`push:${signatureFor(href)}`)) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'push', href });
          return;
        }
        return router.push(href as Parameters<typeof router.push>[0]);
      }) as (typeof router)['push'],
      navigate: ((href: Href) => {
        if (shouldSuppress(`navigate:${signatureFor(href)}`)) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'navigate', href });
          return;
        }
        return router.navigate(href as Parameters<typeof router.navigate>[0]);
      }) as (typeof router)['navigate'],
      replace: ((href: Href) => {
        if (shouldSuppress(`replace:${signatureFor(href)}`)) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'replace', href });
          return;
        }
        return router.replace(href as Parameters<typeof router.replace>[0]);
      }) as (typeof router)['replace'],
      back: () => {
        if (shouldSuppress('back:')) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'back' });
          return;
        }
        return router.back();
      },
      dismiss: ((count?: number) => {
        if (shouldSuppress(`dismiss:${count ?? ''}`)) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'dismiss', count });
          return;
        }
        return router.dismiss(count);
      }) as (typeof router)['dismiss'],
      dismissAll: () => {
        if (shouldSuppress('dismissAll:')) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'dismissAll' });
          return;
        }
        return router.dismissAll();
      },
      dismissTo: ((href: Href) => {
        if (shouldSuppress(`dismissTo:${signatureFor(href)}`)) {
          paymentLog.debug('navigation.guard.suppressed', { method: 'dismissTo', href });
          return;
        }
        return router.dismissTo(href as Parameters<typeof router.dismissTo>[0]);
      }) as (typeof router)['dismissTo'],
    }),
    []
  );
}

/**
 * Imperative variant for non-React modules (helpers, lib functions). Same
 * cooldown as `useGuardedRouter` so double-clicks routed through helpers
 * are also caught.
 */
export const guardedRouter: GuardedRouter = {
  raw: router,
  push: ((href: Href) => {
    if (shouldSuppress(`push:${signatureFor(href)}`)) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'push', href });
      return;
    }
    return router.push(href as Parameters<typeof router.push>[0]);
  }) as (typeof router)['push'],
  navigate: ((href: Href) => {
    if (shouldSuppress(`navigate:${signatureFor(href)}`)) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'navigate', href });
      return;
    }
    return router.navigate(href as Parameters<typeof router.navigate>[0]);
  }) as (typeof router)['navigate'],
  replace: ((href: Href) => {
    if (shouldSuppress(`replace:${signatureFor(href)}`)) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'replace', href });
      return;
    }
    return router.replace(href as Parameters<typeof router.replace>[0]);
  }) as (typeof router)['replace'],
  back: () => {
    if (shouldSuppress('back:')) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'back' });
      return;
    }
    return router.back();
  },
  dismiss: ((count?: number) => {
    if (shouldSuppress(`dismiss:${count ?? ''}`)) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'dismiss', count });
      return;
    }
    return router.dismiss(count);
  }) as (typeof router)['dismiss'],
  dismissAll: () => {
    if (shouldSuppress('dismissAll:')) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'dismissAll' });
      return;
    }
    return router.dismissAll();
  },
  dismissTo: ((href: Href) => {
    if (shouldSuppress(`dismissTo:${signatureFor(href)}`)) {
      paymentLog.debug('navigation.guard.suppressed', { method: 'dismissTo', href });
      return;
    }
    return router.dismissTo(href as Parameters<typeof router.dismissTo>[0]);
  }) as (typeof router)['dismissTo'],
};

/** Reset the cooldown gate. Test-only. */
export function __resetGuardForTests(): void {
  lastNavAt = 0;
  lastSignature = '';
}
