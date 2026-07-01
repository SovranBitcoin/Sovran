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
import { useNutDropAutoRedeem } from '@/features/nearPay/hooks/useNutDropAutoRedeem';
import { bitchatLog, initLog, useInitMount } from '@/shared/lib/logger';
import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';

/**
 * A Nut Drop arrives as a private DM whose entire content is a cashu token.
 * Those are consumed by the auto-redeem pipeline and must NOT render as chat
 * bubbles, so suppress any DM that is nothing but a token. A normal chat
 * message that merely embeds a token (with surrounding text) is left alone.
 */
function isPureTokenDm(content: string): boolean {
  const token = extractCashuToken(content);
  return !!token && token.trim() === content.trim();
}

initLog('Module', 'BitchatBLEProvider loaded');

/**
 * Invisible component. Mount inside `AccountScopedProviders` (not outer
 * providers) so listeners reset when the profile switches.
 */
export function BitchatBLEProvider({ children }: { children: React.ReactNode }) {
  useInitMount('BitchatBLEProvider');

  // Nut Drop auto-redeem: classifies every inbound private DM against the
  // active profile's P2PK lock key and redeems locked-to-me OR bearer tokens
  // via the persisted queue. Lives here (not on a screen) so drops are captured
  // and redeemed regardless of which surface is open.
  useNutDropAutoRedeem();

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
      // Nut Drop token DMs are handled by useNutDropAutoRedeem; keep them out
      // of the chat thread so a payment never shows up as a raw-token bubble.
      if (isPureTokenDm(event.content)) {
        bitchatLog.info('bitchat.provider.dm_token_suppressed', {
          peerID: event.peerID,
          contentLen: event.content.length,
          isOwn: event.isOwn,
        });
        return;
      }
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
