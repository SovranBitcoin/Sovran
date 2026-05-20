/**
 * @fileoverview `navigateToProfile` — unify contact-row press handling
 * across the Contacts tab and global search feed. Extracted from
 * `ContactListItem` so both call sites (ContactsScreen + SearchResultsList)
 * share the same pre-nav steps: dismiss the keyboard, emit the press log,
 * carry the optional mintUrl param through to the profile screen.
 */

import { Keyboard } from 'react-native';

import { paymentLog } from '@/shared/lib/logger';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

export function navigateToProfile(pubkey: string | null | undefined, mintUrl?: string): void {
  Keyboard.dismiss();
  if (!pubkey) return;
  paymentLog.info('contact.profile.press', { pubkey, ...(mintUrl ? { mintUrl } : {}) });
  // push (not navigate) so each profile pushes a new stack entry; tapping a
  // follower from inside a profile then back returns to the previous one.
  guardedRouter.push({
    pathname: '/(user-flow)/profile',
    params: { pubkey, ...(mintUrl ? { mintUrl } : {}) },
  });
}
