/**
 * @fileoverview `navigateToContact` — unify contact-row press handling
 * across the Contacts tab and global search feed. Extracted from
 * `ContactListItem` so both call sites (ContactsScreen + SearchResultsList)
 * share the same pre-nav steps: dismiss the keyboard, emit the press log,
 * carry the optional mintUrl param through to the profile screen.
 */

import { Keyboard } from 'react-native';
import { router } from 'expo-router';

import { paymentLog } from '@/shared/lib/logger';

export function navigateToContact(pubkey: string, mintUrl?: string): void {
  Keyboard.dismiss();
  if (!pubkey) return;
  paymentLog.info('contact.item.press', { pubkey, ...(mintUrl ? { mintUrl } : {}) });
  router.navigate({
    pathname: '/(user-flow)/profile' as any,
    params: { pubkey, ...(mintUrl ? { mintUrl } : {}) },
  });
}
