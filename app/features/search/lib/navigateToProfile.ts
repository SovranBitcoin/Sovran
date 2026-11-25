/**
 * @fileoverview `navigateToProfile` — one press handler for person rows in
 * search (results and the recent-people strip): dismiss the keyboard, emit the
 * press log, carry the optional mintUrl param through to the profile screen.
 */

import { paymentLog, mintUrlLogFields } from '@/shared/lib/logger';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { runAfterNativeSearchDismiss } from '@/shared/ui/composed/search/nativeSearchDismiss';

export function navigateToProfile(pubkey: string | null | undefined, mintUrl?: string): void {
  if (!pubkey) {
    runAfterNativeSearchDismiss(() => {});
    return;
  }
  paymentLog.info('contact.profile.press', {
    pubkey,
    ...(mintUrl ? mintUrlLogFields(mintUrl) : {}),
  });
  // Deactivate iOS 26's integrated search controller before pushing onto the
  // root stack so the bottom native tabs stay intact when navigating back.
  // push (not navigate) so each profile pushes a new stack entry; tapping a
  // follower from inside a profile then back returns to the previous one.
  runAfterNativeSearchDismiss(() => {
    guardedRouter.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey, ...(mintUrl ? { mintUrl } : {}) },
    });
  });
}
