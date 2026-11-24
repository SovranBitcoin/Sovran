/**
 * @fileoverview `navigateToProfile` — one press handler for person rows in
 * search (results and the recent-people strip): dismiss the keyboard, emit the
 * press log, carry the optional mintUrl param through to the profile screen.
 */

import { Keyboard } from 'react-native';

import { paymentLog, mintUrlLogFields } from '@/shared/lib/logger';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

export function navigateToProfile(pubkey: string | null | undefined, mintUrl?: string): void {
  Keyboard.dismiss();
  if (!pubkey) return;
  paymentLog.info('contact.profile.press', {
    pubkey,
    ...(mintUrl ? mintUrlLogFields(mintUrl) : {}),
  });
  // push (not navigate) so each profile pushes a new stack entry; tapping a
  // follower from inside a profile then back returns to the previous one.
  guardedRouter.push({
    pathname: '/(user-flow)/profile',
    params: { pubkey, ...(mintUrl ? { mintUrl } : {}) },
  });
}
