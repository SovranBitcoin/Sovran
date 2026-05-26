import { useMemo } from 'react';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';

import { deriveBitchatBLEIdentityMaterial } from '@/features/bitchat/lib/bleIdentity';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

export function useBitchatBLEIdentityMaterial(): BitchatBLEIdentityMaterial | null {
  const { keys } = useNostrKeysContext();

  return useMemo(() => {
    if (!keys?.privateKey || !keys.pubkey) return null;
    return deriveBitchatBLEIdentityMaterial({
      privateKey: keys.privateKey,
      pubkey: keys.pubkey,
    });
  }, [keys?.privateKey, keys?.pubkey]);
}
