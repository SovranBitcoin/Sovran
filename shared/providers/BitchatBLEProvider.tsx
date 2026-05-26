/**
 * @fileoverview App-wide bitchat BLE DM listener lifecycle.
 *
 * Keeps inbound DM and delivery-status listeners mounted for the lifetime of
 * the account scope without starting the BLE mesh at app boot. Starting BLE
 * immediately announces to nearby bitchat clients, so discovery is now owned
 * by explicit peer-list/chat surfaces instead of ordinary app launch.
 *
 * Why a provider instead of per-screen start/stop:
 *   - Inbound DMs and delivery-status events should be captured once BLE has
 *     been explicitly started, even if the DM screen is closed.
 *   - `useBitChat(transport='ble')` does not call `stopBLE()` on cleanup,
 *     because other explicit BLE consumers may still be using the mesh.
 */

import React, { useEffect } from 'react';
import { addBLEDeliveryStatusListener, addBLEPrivateMessageListener } from 'bitchat-module';
import { useBitchatDmMessagesStore } from '@/features/bitchat/stores/bitchatDmMessages';
import { bitchatLog, initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'BitchatBLEProvider loaded');

/**
 * Invisible component. Mount inside `AccountScopedProviders` (not outer
 * providers) so listeners reset when the profile switches.
 */
export function BitchatBLEProvider({ children }: { children: React.ReactNode }) {
  useInitMount('BitchatBLEProvider');

  // App-wide BLE-DM message + delivery-status listeners. Mounted here (not
  // on the DM screen) so:
  //   1. Inbound DMs aren't dropped while the DM screen is closed — they're
  //      buffered in the store and rendered the next time the user opens it.
  //   2. Delivery status transitions for in-flight outbound messages keep
  //      flowing even if the user navigates away mid-send, so the bubble
  //      reflects the true final state on return.
  // Independent of `nickname` — once the mesh has started, these listeners
  // should live for the whole account scope.
  useEffect(() => {
    const appendIncoming = useBitchatDmMessagesStore.getState().appendIncoming;
    const applyDeliveryStatus = useBitchatDmMessagesStore.getState().applyDeliveryStatus;

    bitchatLog.info('bitchat.provider.dm_listeners_mounted');

    const msgSub = addBLEPrivateMessageListener((event) => {
      bitchatLog.info('bitchat.provider.dm_inbound', {
        peerID: event.peerID,
        contentLen: event.content.length,
        isOwn: event.isOwn,
      });
      appendIncoming(event);
    });
    const statusSub = addBLEDeliveryStatusListener((event) => {
      bitchatLog.info('bitchat.provider.dm_status', {
        messageID: event.messageID,
        status: event.status,
        reason: event.reason,
      });
      applyDeliveryStatus(event);
    });

    return () => {
      msgSub.remove();
      statusSub.remove();
    };
  }, []);

  return <>{children}</>;
}
