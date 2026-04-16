import { useState, useEffect, useCallback } from 'react';
import {
  startBLE,
  stopBLE,
  sendBLEMessage,
  addBLEMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  getBLEState,
  getBLEDiagnostics,
  startNostr,
  joinGeohash,
  leaveGeohash,
  sendGeohashMessage,
  addNostrMessageListener,
  type ChatMessage,
  type BLEMessageEvent,
  type NostrMessageEvent,
} from 'bitchat-module';
import { useBitchatNickname } from './useBitchatNickname';
import { log } from '@/shared/lib/logger';

const bitchatLog = log.child({ module: 'bitchat' });

interface UseBitChatResult {
  messages: ChatMessage[];
  isConnected: boolean;
  sendMessage: (content: string) => Promise<void>;
}

export function useBitChat(
  geohash: string,
  transport: 'nostr' | 'ble' = 'nostr'
): UseBitChatResult {
  const nickname = useBitchatNickname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // --- BLE transport ---
  useEffect(() => {
    if (transport !== 'ble') {
      bitchatLog.debug('bitchat.hook.skip', { reason: 'transport_not_ble', transport });
      return;
    }

    bitchatLog.info('bitchat.hook.ble_start', { hasNickname: !!nickname });
    startBLE(nickname)
      .then(() => {
        const state = getBLEState();
        bitchatLog.info('bitchat.hook.ble_started', { state });
        setIsConnected(true);
      })
      .catch((err) => {
        bitchatLog.error('bitchat.hook.ble_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    const stateSub = addBLEStateListener((event) => {
      bitchatLog.info('bitchat.hook.ble_state', { state: event.state });
    });

    const peerSub = addBLEPeerListener((event) => {
      bitchatLog.info('bitchat.hook.ble_peer', event);
    });

    // Snapshot BLE state + peer list periodically. Critical for diagnosing
    // "zero peers discovered" — we need to know whether CBCentralManager is
    // actually scanning and CBPeripheralManager is actually advertising.
    const peerPoll = setInterval(() => {
      const diag = getBLEDiagnostics();
      bitchatLog.info('bitchat.hook.ble_diag', { ...diag });
    }, 10_000);

    const sub = addBLEMessageListener((event: BLEMessageEvent) => {
      bitchatLog.debug('bitchat.hook.ble_message', {
        id: event.id,
        sender: event.sender,
      });
      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderPubkey: event.senderPeerID,
        timestamp: event.timestamp,
        isPrivate: event.isPrivate,
        isOwn: false, // BLE messages from others; own messages are echoed locally.
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });

    return () => {
      clearInterval(peerPoll);
      sub.remove();
      stateSub.remove();
      peerSub.remove();
      stopBLE();
      setMessages([]);
      setIsConnected(false);
    };
  }, [transport, nickname]);

  // --- Nostr transport (native BitChatNostrBridge) ---
  //
  // Native handles relay selection (upstream's GeoRelayDirectory picks the 5
  // geographically-closest relays from the 304-entry CSV) and identity
  // derivation (HMAC-SHA256(deviceSeed, geohash) per geohash, device seed in
  // Keychain). We don't pass a private key; native owns that.
  useEffect(() => {
    if (transport !== 'nostr') {
      bitchatLog.debug('bitchat.hook.skip', { reason: 'transport_not_nostr', transport });
      return;
    }
    if (!geohash) {
      bitchatLog.debug('bitchat.hook.skip', { reason: 'no_geohash', geohash });
      return;
    }

    let cancelled = false;

    bitchatLog.info('bitchat.hook.setup', { geohash, hasNickname: !!nickname });

    const sub = addNostrMessageListener((event: NostrMessageEvent) => {
      bitchatLog.debug('bitchat.hook.message', {
        id: event.id,
        isOwn: event.isOwn,
        geohash: event.geohash,
      });
      // Filter by active geohash — native may still deliver events for a
      // just-unsubscribed channel if the relay is slow to process CLOSE.
      if (event.geohash !== geohash) return;

      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderPubkey: event.senderPubkey,
        timestamp: event.timestamp,
        isPrivate: false,
        isOwn: event.isOwn,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });

    (async () => {
      try {
        await startNostr();
        if (cancelled) return;
        await joinGeohash(geohash);
        if (cancelled) return;
        setIsConnected(true);
      } catch (err) {
        bitchatLog.error('bitchat.hook.nostr_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      sub.remove();
      leaveGeohash().catch((err) => {
        bitchatLog.warn('bitchat.hook.leave_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      setMessages([]);
      setIsConnected(false);
    };
  }, [geohash, transport, nickname]);

  const sendMessage = useCallback(
    async (content: string) => {
      bitchatLog.info('bitchat.hook.send', { transport, contentLen: content.length });
      if (transport === 'ble') {
        // BLE doesn't echo own messages back, so add locally.
        const ownMsg: ChatMessage = {
          id: `own-${Date.now()}`,
          content,
          sender: nickname || 'You',
          senderPubkey: '',
          timestamp: Date.now(),
          isPrivate: false,
          isOwn: true,
        };
        setMessages((prev) => [...prev, ownMsg]);
        try {
          await sendBLEMessage(content);
        } catch (err) {
          bitchatLog.error('bitchat.hook.ble_send_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // Nostr: the relay echoes our own event back, so the listener surfaces
        // it with isOwn=true. No optimistic local add — avoids id-dedup dance.
        try {
          await sendGeohashMessage(content, nickname);
        } catch (err) {
          bitchatLog.error('bitchat.hook.nostr_send_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [transport, nickname]
  );

  return { messages, isConnected, sendMessage };
}
