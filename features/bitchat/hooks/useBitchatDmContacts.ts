import { useCallback, useEffect, useState } from 'react';
import { addBLEPrivateMessageListener, getBLEDmHistory, type BLEDmContact } from 'bitchat-module';
import { useBitchatProfileScope } from '../lib/profileScope';

/**
 * Tracks the persisted BLE-DM peer history.
 *
 * Sources:
 *  - Initial snapshot via `getBLEDmHistory()` on mount.
 *  - Re-fetch on every `onBLEPrivateMessage` event (inbound message recorded
 *    into UserDefaults by the native bridge — refresh so the new peer surfaces
 *    immediately in the Contacts list).
 *
 * Outbound DMs also get persisted natively (`sendPrivateMessage` calls
 * `recordDmPeer`), but they don't fire `onBLEPrivateMessage` to JS — the
 * Contacts screen is unlikely to be mounted at the moment the user sends, so
 * we rely on the next mount picking it up.
 */
export function useBitchatDmContacts(): { contacts: BLEDmContact[] } {
  const profileScope = useBitchatProfileScope();
  const [contacts, setContacts] = useState<BLEDmContact[]>(() =>
    profileScope ? getBLEDmHistory(profileScope) : []
  );

  const refresh = useCallback(() => {
    setContacts(profileScope ? getBLEDmHistory(profileScope) : []);
  }, [profileScope]);

  useEffect(() => {
    refresh();
    const sub = addBLEPrivateMessageListener(() => {
      refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { contacts };
}
