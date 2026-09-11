import { useState, useEffect, useCallback } from 'react';
import {
  startBLE,
  sendBLEMessage,
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  addBLEMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  getBLEPeers,
  getBLEState,
  startNostr,
  joinGeohash,
  sendGeohashMessage,
  sendGeohashPrivateMessage,
  addNostrMessageListener,
  addNostrPrivateMessageListener,
  type ChatMessage,
  type BLEMessageEvent,
  type NostrMessageEvent,
  type NostrPrivateMessageEvent,
} from 'bitchat-module';
import { useBitchatNickname } from './useBitchatNickname';
import { useBitchatDmMessagesStore, type BleDmMessage } from '../stores/bitchatDmMessages';
import { useBitchatBLEIdentityMaterial } from './useBitchatBLEIdentityMaterial';
import { useBitchatProfileScope } from '../lib/profileScope';
import { bitchatLog } from '@/shared/lib/logger';
import { mintLocalId } from '@/shared/lib/id';
import { asNostrPubkeyHex } from '@/shared/lib/protocolIds';

const MESSAGE_BUFFER_CAP = 500;
/**
 * Time the JS-side watchdog gives a `sending`-state outbound DM before
 * declaring the handshake/transport stuck. 15s comfortably covers the
 * worst-case BLE handshake (typically < 2s) without making the user wait
 * minutes for a peer that's simply gone.
 */
const BLE_DM_STUCK_TIMEOUT_MS = 15_000;

function appendChatMessage(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  // The 'nostr' (public geohash) transport echoes our own outbound event
  // back via the subscription. We've already shown an optimistic row keyed
  // on a local `mintLocalId('own')` id; matching content + isOwn within a
  // recent window means this is the relay echo and we drop it instead of
  // duplicating the bubble. The local id never reaches the relay, so this
  // is the only sound match key.
  if (msg.isOwn) {
    const localCopy = prev
      .slice()
      .reverse()
      .find(
        (m) =>
          m.isOwn && m.content === msg.content && Math.abs(m.timestamp - msg.timestamp) < 60_000
      );
    if (localCopy) return prev;
  }
  const last = prev[prev.length - 1];
  const inOrder = !last || msg.timestamp >= last.timestamp;
  const next = inOrder ? [...prev, msg] : [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
  return next.length > MESSAGE_BUFFER_CAP ? next.slice(next.length - MESSAGE_BUFFER_CAP) : next;
}

/** Both Nostr transports carry the same event shape; only privacy differs. */
function nostrChatMessage(
  event: NostrMessageEvent | NostrPrivateMessageEvent,
  isPrivate: boolean
): ChatMessage {
  return {
    id: event.id,
    content: event.content,
    sender: event.sender,
    senderId: event.senderPubkey,
    timestamp: event.timestamp,
    isPrivate,
    isOwn: event.isOwn,
  };
}

/**
 * Bring up Nostr and join `geohash`, resolving `true` once connected.
 *
 * Native keeps a SINGLE active geohash that fans out to both the public chat
 * sub (`geo-{g}`) and the gift-wrap DM sub (`geo-dm-{g}`), which is why
 * neither caller may call `leaveGeohash` on unmount — doing so tears down any
 * concurrent thread on the same geohash. The next `joinGeohash(other)`
 * replaces the active channel; full-app teardown calls `leaveGeohash()` in
 * BitChatNostrBridge.swift.
 */
async function connectNostrGeohash(
  geohash: string,
  profileScope: string | undefined,
  isCancelled: () => boolean,
  failureEvent: string
): Promise<boolean> {
  try {
    if (!profileScope) return false;
    await startNostr(profileScope);
    if (isCancelled()) return false;
    await joinGeohash(geohash);
    if (isCancelled()) return false;
    return true;
  } catch (err) {
    bitchatLog.error(failureEvent, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
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
  const profileScope = useBitchatProfileScope();
  const identityMaterial = useBitchatBLEIdentityMaterial();
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
    // Opening an explicit BLE chat starts the mesh. App launch deliberately
    // does not start BLE because upstream announces as soon as services
    // start.
    if (!profileScope || !identityMaterial) return;

    startBLE(nickname, profileScope, identityMaterial)
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
      bitchatLog.debug(
        'bitchat.hook.ble_peer',
        event.type === 'list'
          ? { type: event.type, peerCount: event.peers.length }
          : {
              type: event.type,
              peerIdPrefix: event.peerID.slice(0, 4),
              isConnected: event.type === 'connected',
            }
      );
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
      // Deliberately DON'T stopBLE here. Other explicit BLE consumers
      // (NetworkSheet, Near Pay, Split Bill) may still be using the mesh.
      // Matches the 'ble-dm' transport below.
      // Buffer reset is handled by the identity-change effect above, not
      // here, so a transient remount or a `nickname` dep change preserves
      // history.
      setIsConnected(false);
    };
  }, [identityMaterial, transport, nickname, profileScope]);

  // ===========================================================
  //  BLE DM — transport === 'ble-dm'
  //
  //  Upstream keeps the BLE mesh running as one process; DM threads are
  //  just a filtered view over `onBLEPrivateMessage`. We don't stop/start
  //  BLE on DM mount — a concurrent public session is fine, and upstream
  //  handshake is lazy. We DO call startBLEPrivateChat to trigger the
  //  Noise handshake eagerly so the first outbound message isn't delayed.
  //
  //  Message buffer is NOT owned by this hook — `BitchatBLEProvider` mounts
  //  the app-wide `addBLEPrivateMessageListener` and pushes events into
  //  `useBitchatDmMessagesStore` so inbound DMs aren't dropped while this
  //  screen is closed. The store also tracks delivery-status transitions
  //  for outbound messages.
  // ===========================================================

  // Subscribe to the per-peer slice of the global DM store. The selector
  // memoises by reference, so unrelated peer updates don't re-render.
  const bleDmMessages = useBitchatDmMessagesStore((state) =>
    transport === 'ble-dm' && dmPeerID ? state.byPeer[dmPeerID] : undefined
  );

  useEffect(() => {
    if (transport !== 'ble-dm' || !dmPeerID || !nickname || !profileScope || !identityMaterial) {
      return;
    }

    bitchatLog.info('bitchat.hook.ble_dm_setup', { peerID: dmPeerID });

    // Reuse the mesh if it's already running (no-op); otherwise start it.
    startBLE(nickname, profileScope, identityMaterial)
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

    return () => {
      // Deliberately DON'T stopBLE — other screens (public mesh chat,
      // NetworkSheet) may still be using it. Message buffer lives in the
      // store, so nothing per-screen to tear down.
      setIsConnected(false);
    };
  }, [identityMaterial, transport, dmPeerID, nickname, profileScope]);

  // ===========================================================
  //  Nostr public chat — transport === 'nostr'
  // ===========================================================

  // `nickname` is deliberately not in this effect's deps: the public-nostr
  // setup path does not pass it to startNostr/joinGeohash, and it's only
  // stamped on outbound messages by sendMessage. Including it would tear
  // down and rebuild the subscription on every kind:0 metadata refresh,
  // wiping the visible message buffer.
  useEffect(() => {
    if (transport !== 'nostr') return;
    if (!geohash) return;

    let cancelled = false;

    bitchatLog.info('bitchat.hook.setup', { geohash });

    const sub = addNostrMessageListener((event: NostrMessageEvent) => {
      if (event.geohash !== geohash) return;
      setMessages((prev) => appendChatMessage(prev, nostrChatMessage(event, false)));
    });

    void connectNostrGeohash(
      geohash,
      profileScope,
      () => cancelled,
      'bitchat.hook.nostr_start_failed'
    ).then((connected) => {
      if (connected) setIsConnected(true);
    });

    return () => {
      cancelled = true;
      sub.remove();
      // No leaveGeohash — see connectNostrGeohash.
      setIsConnected(false);
    };
  }, [geohash, transport, profileScope]);

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
      setMessages((prev) => appendChatMessage(prev, nostrChatMessage(event, true)));
    });

    void connectNostrGeohash(
      geohash,
      profileScope,
      () => cancelled,
      'bitchat.hook.nostr_dm_start_failed'
    ).then((connected) => {
      if (connected) setIsConnected(true);
    });

    return () => {
      cancelled = true;
      sub.remove();
      // No leaveGeohash — other screens may be using it. See connectNostrGeohash.
      setIsConnected(false);
    };
    // `nickname` is omitted for the same reason as the public-nostr effect.
  }, [transport, dmPeerID, geohash, profileScope]);

  // ===========================================================
  //  Send
  // ===========================================================

  /**
   * Optimistic local echo, shared by every transport whose bubbles live in
   * this hook's own buffer: show the row immediately, clear `isPending` when
   * the transport accepts it, drop it again if the send throws. `ble-dm` is
   * the exception — its rows live in the global store so the app-wide
   * delivery-status listener can drive them.
   */
  const sendWithLocalEcho = useCallback(
    async (
      content: string,
      isPrivate: boolean,
      failureEvent: string,
      send: () => Promise<unknown>
    ) => {
      const ownMsg: ChatMessage = {
        id: mintLocalId('own'),
        content,
        sender: nickname || 'You',
        senderId: '',
        timestamp: Date.now(),
        isPrivate,
        isOwn: true,
        isPending: true,
      };
      setMessages((prev) => [...prev, ownMsg]);
      try {
        await send();
        setMessages((prev) =>
          prev.map((m) => (m.id === ownMsg.id ? { ...m, isPending: false } : m))
        );
      } catch (err) {
        bitchatLog.error(failureEvent, {
          error: err instanceof Error ? err.message : String(err),
        });
        setMessages((prev) => prev.filter((m) => m.id !== ownMsg.id));
      }
    },
    [nickname]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      bitchatLog.info('bitchat.hook.send', { transport, contentLen: content.length });

      switch (transport) {
        case 'ble': {
          // Public BLE — the mesh sends no own-echo, so the local row is the
          // only one this bubble will ever get.
          await sendWithLocalEcho(content, false, 'bitchat.hook.ble_send_failed', () =>
            sendBLEMessage(content)
          );
          break;
        }

        case 'ble-dm': {
          if (!dmPeerID) return;
          // Noise-encrypted DM. Add an optimistic message to the GLOBAL
          // store (not local state) so the app-wide delivery-status
          // listener in BitchatBLEProvider can update its
          // status as the native side reports
          // `sending → sent → delivered`. Empty senderId matches the ble
          // public path so `useMessageGrouping` doesn't conflate own +
          // peer runs.
          const messageID = mintLocalId('ble-dm');
          const ownMsg: BleDmMessage = {
            id: messageID,
            content,
            sender: nickname || 'You',
            senderId: '',
            timestamp: Date.now(),
            isPrivate: true,
            isOwn: true,
            isPending: true,
            deliveryStatus: 'sending',
          };
          const store = useBitchatDmMessagesStore.getState();
          store.appendOutgoing(ownMsg, dmPeerID);

          // Diagnostic: capture the recipient's real-time link state at send
          // time. `isConnected` is the cached announce-state and can stay
          // true after the BLE link silently dies; `hasDirectLink` is the
          // authoritative flag for whether sendEncrypted can deliver without
          // bouncing through mesh-flood + 15s spool. When users report
          // "Network shows connected but DMs fail", this log distinguishes
          // (a) peer genuinely reachable / handshake failing for other reason
          // from (b) cached-state lying about reachability.
          const peerSnapshot = getBLEPeers().find((p) => p.peerID === dmPeerID);
          bitchatLog.info('bitchat.hook.ble_dm_link_state', {
            peerID: dmPeerID,
            messageID,
            knownToNative: !!peerSnapshot,
            isConnected: peerSnapshot?.isConnected ?? false,
            hasDirectLink: peerSnapshot?.hasDirectLink ?? false,
            lastSeenAgeMs: peerSnapshot ? Math.round(Date.now() - peerSnapshot.lastSeen) : null,
          });

          // Watchdog: if this message hasn't reached at least `sent` within
          // BLE_DM_STUCK_TIMEOUT_MS, mark it `failed` so the bubble surfaces
          // a tap-to-retry instead of spinning forever.
          //
          // Deliberately does NOT call `resetBLEPrivateChat` + restart the
          // handshake on its own — upstream's `NoiseRateLimiter` enforces
          // 10 handshakes/peer/minute (NoiseSecurityConstants.swift:31), and
          // an auto-reset every 15s combined with the natural handshake the
          // next send triggers can burn through that budget in < 90s. Once
          // exhausted, BOTH sides silently reject handshake init packets at
          // the rate-limit gate for the next minute, so EVERY following DM
          // fails. User-initiated retry (the bubble tap) spaces attempts
          // out enough to stay under the limit.
          const watchdog = setTimeout(() => {
            const current = useBitchatDmMessagesStore
              .getState()
              .getForPeer(dmPeerID)
              .find((m) => m.id === messageID);
            if (current?.deliveryStatus !== 'sending') return;
            bitchatLog.warn('bitchat.hook.ble_dm_stuck', {
              peerID: dmPeerID,
              messageID,
              timeoutMs: BLE_DM_STUCK_TIMEOUT_MS,
            });
            useBitchatDmMessagesStore.getState().applyDeliveryStatus({
              messageID,
              status: 'failed',
              reason: 'timeout',
            });
          }, BLE_DM_STUCK_TIMEOUT_MS);

          try {
            const startedAt = Date.now();
            const returnedID = await sendBLEPrivateMessage(dmPeerID, content, nickname, messageID);
            // Diagnostic: confirms the native AsyncFunction returned cleanly
            // (mesh started, peerID valid, dispatch enqueued). Useful for
            // distinguishing "native send rejected" from "native sent but no
            // delivery-status events arrived" in log-doctor.
            bitchatLog.info('bitchat.hook.ble_dm_send_resolved', {
              messageID,
              returnedID,
              dispatchMs: Date.now() - startedAt,
            });
            // Delivery state transitions arrive on `onBLEDeliveryStatus`
            // via the app-level listener — the watchdog cancels itself
            // when applyDeliveryStatus moves the message past `sending`.
          } catch (err) {
            clearTimeout(watchdog);
            bitchatLog.error('bitchat.hook.ble_dm_send_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            // Native rejected outright (e.g. mesh not started, invalid
            // peerID). Mark the bubble failed so the user sees it.
            store.applyDeliveryStatus({
              messageID,
              status: 'failed',
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }

        case 'nostr': {
          // Public geohash chat echoes our own message back via the
          // subscription. The optimistic row is keyed on the local mint id,
          // so the later relay echo arrives as a distinct message —
          // `appendChatMessage` is what collapses the visual duplicate.
          await sendWithLocalEcho(content, false, 'bitchat.hook.nostr_send_failed', () =>
            sendGeohashMessage(content, nickname)
          );
          break;
        }

        case 'nostr-dm': {
          if (!dmPeerID) return;
          // NIP-17 gift-wrap DMs don't echo back to the sender via the
          // subscription, so the local row is the only one.
          // In this transport dmPeerID carries the peer's NOSTR pubkey hex
          // (from senderPubkey on geohash events) — the checked cast guards
          // against a BLE peer id / Noise key ever reaching the DM path
          // (both are hex; a shape-mismatch throw lands in the catch below
          // as nostr_dm_send_failed).
          await sendWithLocalEcho(content, true, 'bitchat.hook.nostr_dm_send_failed', () =>
            sendGeohashPrivateMessage(asNostrPubkeyHex(dmPeerID), content)
          );
          break;
        }
      }
    },
    [transport, nickname, dmPeerID, sendWithLocalEcho]
  );

  // For `ble-dm` the source of truth is the global store (populated by
  // BitchatBLEProvider's listener + this hook's send path). All other
  // transports use the local `messages` buffer.
  const effectiveMessages: ChatMessage[] =
    transport === 'ble-dm' ? (bleDmMessages ?? []) : messages;

  return { messages: effectiveMessages, isConnected, sendMessage };
}
