import { useState, useEffect, useCallback } from 'react';
import {
  startBLE,
  sendBLEMessage,
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  getBLEState,
  startNostr,
  joinGeohash,
  sendGeohashMessage,
  sendGeohashPrivateMessage,
  addNostrMessageListener,
  addNostrPrivateMessageListener,
  type ChatMessage,
  type BLEMessageEvent,
  type BLEPrivateMessageEvent,
  type NostrMessageEvent,
  type NostrPrivateMessageEvent,
} from 'bitchat-module';
import { useBitchatNickname } from './useBitchatNickname';
import { bitchatLog } from '@/shared/lib/logger';
import { mintLocalId } from '@/shared/lib/id';

const MESSAGE_BUFFER_CAP = 500;

function appendChatMessage(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  const last = prev[prev.length - 1];
  const inOrder = !last || msg.timestamp >= last.timestamp;
  const next = inOrder ? [...prev, msg] : [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
  return next.length > MESSAGE_BUFFER_CAP ? next.slice(next.length - MESSAGE_BUFFER_CAP) : next;
}

/**
 * Public channel transports: `'ble'` = BLE mesh public chat,
 * `'nostr'` = geohash public chat via Nostr.
 * Private 1:1 transports: `'ble-dm'` = Noise-encrypted mesh DM,
 * `'nostr-dm'` = NIP-17 gift-wrapped geohash DM.
 */
type BitChatTransport = 'nostr' | 'ble' | 'ble-dm' | 'nostr-dm';

/**
 * For `'ble-dm'`: pass the peer's 16-hex PeerID.
 * For `'nostr-dm'`: pass the peer's Nostr hex pubkey (from an
 * `onNostrMessage` `senderPubkey`).
 */
interface DMTarget {
  peerID: string;
  /** Optional display nickname for UI + outbound message stamp. */
  nickname?: string;
}

interface UseBitChatOptions {
  /** DM target — required for ble-dm / nostr-dm transports. */
  dm?: DMTarget;
}

interface UseBitChatResult {
  messages: ChatMessage[];
  isConnected: boolean;
  sendMessage: (content: string) => Promise<void>;
}

export function useBitChat(
  geohash: string | undefined,
  transport: BitChatTransport = 'nostr',
  options: UseBitChatOptions = {}
): UseBitChatResult {
  const nickname = useBitchatNickname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const dmPeerID = options.dm?.peerID;

  // Reset the buffer only when the *subscription identity* changes — i.e.
  // we're now watching a different transport / peer / geohash and the old
  // messages no longer apply. Keying state-reset off the per-transport
  // cleanups (the prior shape) wiped messages on any dep churn — e.g.
  // `nickname` resolving from useBitchatNickname after first render — and,
  // for ble-dm in particular, that loss is permanent because BLE has no
  // replay path.
  useEffect(() => {
    setMessages([]);
  }, [transport, dmPeerID, geohash]);

  // ===========================================================
  //  BLE public chat — transport === 'ble'
  // ===========================================================

  useEffect(() => {
    if (transport !== 'ble') return;

    bitchatLog.info('bitchat.hook.ble_start', { hasNickname: !!nickname });
    // BLE lifecycle is owned by `BitchatBLEProvider` (mounted in
    // AccountScopedProviders) so the mesh stays running across the whole
    // app. We still call `startBLE` here as a safety net — it's idempotent
    // on the native side and covers the case where the provider hasn't
    // fired yet (e.g. mesh-chat screen opened before the nickname was
    // available).
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
      // Redacted projection: peerID is a stable cross-session identifier and
      // nickname is user-controlled (potential PII). Keep just the prefix +
      // connection state for diagnostics.
      bitchatLog.debug('bitchat.hook.ble_peer', {
        peerIdPrefix: event.peerID.slice(0, 4),
        isConnected: event.isConnected,
      });
    });

    const sub = addBLEMessageListener((event: BLEMessageEvent) => {
      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderId: event.senderPeerID,
        timestamp: event.timestamp,
        isPrivate: event.isPrivate,
        isOwn: false,
      };
      setMessages((prev) => appendChatMessage(prev, msg));
    });

    return () => {
      sub.remove();
      stateSub.remove();
      peerSub.remove();
      // Deliberately DON'T stopBLE here. The app-wide `BitchatBLEProvider`
      // owns the mesh lifecycle — stopping it when a chat screen unmounts
      // would yank peers out from under the Split Bill picker and any
      // other concurrent consumer. Matches the 'ble-dm' transport below.
      // Buffer reset is handled by the identity-change effect above, not
      // here, so a transient remount or a `nickname` dep change preserves
      // history.
      setIsConnected(false);
    };
  }, [transport, nickname]);

  // ===========================================================
  //  BLE DM — transport === 'ble-dm'
  //
  //  Upstream keeps the BLE mesh running as one process; DM threads are
  //  just a filtered view over `onBLEPrivateMessage`. We don't stop/start
  //  BLE on DM mount — a concurrent public session is fine, and upstream
  //  handshake is lazy. We DO call startBLEPrivateChat to trigger the
  //  Noise handshake eagerly so the first outbound message isn't delayed.
  // ===========================================================

  useEffect(() => {
    if (transport !== 'ble-dm' || !dmPeerID || !nickname) return;

    bitchatLog.info('bitchat.hook.ble_dm_setup', { peerID: dmPeerID });

    // Reuse the mesh if it's already running (no-op); otherwise start it.
    startBLE(nickname)
      .then(() => setIsConnected(true))
      .catch((err) => {
        bitchatLog.error('bitchat.hook.ble_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Trigger Noise handshake eagerly.
    startBLEPrivateChat(dmPeerID).catch((err) => {
      bitchatLog.warn('bitchat.hook.ble_dm_handshake_failed', {
        peerID: dmPeerID,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const sub = addBLEPrivateMessageListener((event: BLEPrivateMessageEvent) => {
      // Only surface messages from this peer into this thread.
      if (event.peerID !== dmPeerID) return;
      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderId: event.peerID,
        timestamp: event.timestamp,
        isPrivate: true,
        isOwn: event.isOwn,
      };
      setMessages((prev) => appendChatMessage(prev, msg));
    });

    return () => {
      sub.remove();
      // Deliberately DON'T stopBLE — other screens (public mesh chat,
      // NetworkSheet) may still be using it. Buffer reset is handled by
      // the identity-change effect above; ble-dm in particular has no
      // replay path, so wiping on every dep churn would lose history.
      setIsConnected(false);
    };
  }, [transport, dmPeerID, nickname]);

  // ===========================================================
  //  Nostr public chat — transport === 'nostr'
  // ===========================================================

  useEffect(() => {
    if (transport !== 'nostr') return;
    if (!geohash) return;

    let cancelled = false;

    bitchatLog.info('bitchat.hook.setup', { geohash, hasNickname: !!nickname });

    const sub = addNostrMessageListener((event: NostrMessageEvent) => {
      if (event.geohash !== geohash) return;
      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderId: event.senderPubkey,
        timestamp: event.timestamp,
        isPrivate: false,
        isOwn: event.isOwn,
      };
      setMessages((prev) => appendChatMessage(prev, msg));
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
      // Don't leave the geohash here — the native side keeps a single
      // active geohash that fans out to BOTH the public chat sub
      // (`geo-{g}`) AND the gift-wrap DM sub (`geo-dm-{g}`), so calling
      // leaveGeohash on public-screen unmount tears down any concurrent
      // nostr-dm thread on the same geohash. Matches the nostr-dm
      // cleanup below. The next joinGeohash(other) replaces the active
      // channel; full-app stop in BitChatNostrBridge.swift calls
      // leaveGeohash() during teardown.
      setIsConnected(false);
    };
  }, [geohash, transport, nickname]);

  // ===========================================================
  //  Nostr DM — transport === 'nostr-dm'
  //
  //  DMs ride the SAME geohash subscription channel the public chat sets
  //  up (native subscribes to both kind-20000 and kind-1059 when we join
  //  a geohash). So we join the geohash here even though we only want
  //  the DM stream — public events will be filtered out client-side.
  // ===========================================================

  useEffect(() => {
    if (transport !== 'nostr-dm' || !dmPeerID || !geohash) return;

    let cancelled = false;

    bitchatLog.info('bitchat.hook.nostr_dm_setup', {
      geohash,
      peerPrefix: dmPeerID.slice(0, 8),
    });

    const sub = addNostrPrivateMessageListener((event: NostrPrivateMessageEvent) => {
      if (event.geohash !== geohash) return;
      // Only surface messages from this peer into this thread.
      if (event.senderPubkey !== dmPeerID) return;
      const msg: ChatMessage = {
        id: event.id,
        content: event.content,
        sender: event.sender,
        senderId: event.senderPubkey,
        timestamp: event.timestamp,
        isPrivate: true,
        isOwn: event.isOwn,
      };
      setMessages((prev) => appendChatMessage(prev, msg));
    });

    (async () => {
      try {
        await startNostr();
        if (cancelled) return;
        await joinGeohash(geohash);
        if (cancelled) return;
        setIsConnected(true);
      } catch (err) {
        bitchatLog.error('bitchat.hook.nostr_dm_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      sub.remove();
      // Don't leave the geohash — other screens may be using it.
      setIsConnected(false);
    };
  }, [transport, dmPeerID, geohash, nickname]);

  // ===========================================================
  //  Send
  // ===========================================================

  const sendMessage = useCallback(
    async (content: string) => {
      bitchatLog.info('bitchat.hook.send', { transport, contentLen: content.length });

      switch (transport) {
        case 'ble': {
          // Public BLE — no own-echo, add locally.
          const ownMsg: ChatMessage = {
            id: mintLocalId('own'),
            content,
            sender: nickname || 'You',
            senderId: '',
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
            setMessages((prev) => prev.filter((m) => m.id !== ownMsg.id));
          }
          break;
        }

        case 'ble-dm': {
          if (!dmPeerID) return;
          // Noise-encrypted DM — also no own-echo, add locally. Use an
          // empty senderId (matching the ble public path) so the shared
          // `useMessageGrouping` doesn't conflate own + peer runs — both
          // sides used `dmPeerID` previously, which dropped the peer's
          // first-in-group avatar/name at every side switch.
          const ownMsg: ChatMessage = {
            id: mintLocalId('own'),
            content,
            sender: nickname || 'You',
            senderId: '',
            timestamp: Date.now(),
            isPrivate: true,
            isOwn: true,
          };
          setMessages((prev) => [...prev, ownMsg]);
          try {
            await sendBLEPrivateMessage(dmPeerID, content, nickname);
          } catch (err) {
            bitchatLog.error('bitchat.hook.ble_dm_send_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            setMessages((prev) => prev.filter((m) => m.id !== ownMsg.id));
          }
          break;
        }

        case 'nostr': {
          try {
            await sendGeohashMessage(content, nickname);
          } catch (err) {
            bitchatLog.error('bitchat.hook.nostr_send_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }

        case 'nostr-dm': {
          if (!dmPeerID) return;
          // NIP-17 gift-wrap DMs don't echo back to the sender via the
          // subscription, so add locally. Empty senderId for the same
          // grouping reason as 'ble-dm' above.
          const ownMsg: ChatMessage = {
            id: mintLocalId('own'),
            content,
            sender: nickname || 'You',
            senderId: '',
            timestamp: Date.now(),
            isPrivate: true,
            isOwn: true,
          };
          setMessages((prev) => [...prev, ownMsg]);
          try {
            await sendGeohashPrivateMessage(dmPeerID, content);
          } catch (err) {
            bitchatLog.error('bitchat.hook.nostr_dm_send_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            setMessages((prev) => prev.filter((m) => m.id !== ownMsg.id));
          }
          break;
        }
      }
    },
    [transport, nickname, dmPeerID]
  );

  return { messages, isConnected, sendMessage };
}
