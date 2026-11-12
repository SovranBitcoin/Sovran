import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  startBLE,
  acquirePublicBLEMesh,
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
  type BitchatBLEIdentityMaterial,
} from 'bitchat-module';
import { useBitchatNickname } from './useBitchatNickname';
import { useBitchatDmMessagesStore, type BleDmMessage } from '../stores/bitchatDmMessages';
import { useBitchatBLEIdentityMaterial } from './useBitchatBLEIdentityMaterial';
import { useBitchatProfileScope } from '../lib/profileScope';
import { bitchatLog } from '@/shared/lib/logger';
import { mintLocalId } from '@/shared/lib/id';
import { asNostrPubkeyHex } from '@/shared/lib/protocolIds';
import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';
import type { ChatBubbleMessage } from '@/shared/ui/composed/chat';

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
    return startFailed(failureEvent)(err);
  }
}

/**
 * Public channel transports: `'ble'` = BLE mesh public chat,
 * `'nostr'` = geohash public chat via Nostr.
 * Private 1:1 transports: `'ble-dm'` = Noise-encrypted mesh DM,
 * `'nostr-dm'` = NIP-17 gift-wrapped geohash DM.
 */
type BitChatTransport = 'nostr' | 'ble' | 'ble-dm' | 'nostr-dm';

interface UseBitChatOptions {
  transport: BitChatTransport;
  /** The channel for `'nostr'`, and the subscription `'nostr-dm'` rides. */
  geohash?: string;
  /**
   * The DM peer: for `'ble-dm'` the peer's 16-hex PeerID, for `'nostr-dm'` the
   * peer's Nostr hex pubkey (from an `onNostrMessage` `senderPubkey`).
   */
  peerID?: string;
}

interface UseBitChatResult {
  /** Rows ready for the chat bubbles, own rows with their delivery status. */
  messages: ChatBubbleMessage[];
  isConnected: boolean;
  sendMessage: (content: string) => Promise<void>;
  /** "Tap to retry" for a failed row not retried yet in this app session, else undefined. */
  retryFor: (message: ChatBubbleMessage) => (() => void) | undefined;
}

/**
 * Failed Bluetooth DMs already retried in this app session, by message id. A
 * retry sends the text again as a new message with its own status and its own
 * retry, so the failed one is retried once. Module scope, so leaving and
 * reopening the chat does not offer it again.
 */
const retriedBleDmIds = new Set<string>();

/**
 * Own rows carry their delivery: a BLE DM's saved status, otherwise sending
 * until the transport accepts it.
 */
function bubbleRow(m: BleDmMessage): ChatBubbleMessage {
  return {
    id: m.id,
    content: m.content,
    senderId: m.senderId,
    sender: m.sender,
    timestamp: m.timestamp,
    isOwn: m.isOwn,
    deliveryStatus: m.isOwn ? (m.deliveryStatus ?? (m.isPending ? 'sending' : 'sent')) : undefined,
    cashuToken: extractCashuToken(m.content) ?? undefined,
  };
}

/** What one transport listens to and how it connects; `connect` resolves true once connected. */
interface Wiring {
  listen(append: (msg: ChatMessage) => void): { remove(): void }[];
  connect(isCancelled: () => boolean): Promise<boolean>;
}

/** Log a failed start and report "not connected". */
function startFailed(event: string) {
  return (err: unknown) => {
    bitchatLog.error(event, { error: err instanceof Error ? err.message : String(err) });
    return false;
  };
}

/**
 * The wiring for `transport`, or null when it cannot start yet. `nickname`
 * and `identityMaterial` are passed only for the Bluetooth transports.
 */
function wiringFor(
  transport: BitChatTransport,
  geohash: string | undefined,
  peerID: string | undefined,
  profileScope: string,
  nickname: string,
  identityMaterial: BitchatBLEIdentityMaterial | null
): Wiring | null {
  switch (transport) {
    case 'ble': {
      bitchatLog.info('bitchat.hook.ble_start', { hasNickname: !!nickname });
      // Opening an explicit BLE chat starts the mesh. App launch deliberately
      // does not start BLE because upstream announces as soon as services
      // start.
      if (!profileScope || !identityMaterial) return null;
      return {
        listen: (append) => [
          addBLEStateListener((event) => {
            bitchatLog.info('bitchat.hook.ble_state', { state: event.state });
          }),
          addBLEPeerListener((event) => {
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
          }),
          addBLEMessageListener((event: BLEMessageEvent) =>
            append({
              id: event.id,
              content: event.content,
              sender: event.sender,
              senderId: event.senderPeerID,
              timestamp: event.timestamp,
              isPrivate: event.isPrivate,
              isOwn: false,
            })
          ),
        ],
        // Deliberately never stopBLE on leaving: other explicit BLE consumers
        // (NetworkSheet, Near Pay, Split Bill) may still be using the mesh.
        connect: () =>
          startBLE({ nickname, profileScope, identityMaterial })
            .then(() => {
              bitchatLog.info('bitchat.hook.ble_started', { state: getBLEState() });
              return true;
            })
            .catch(startFailed('bitchat.hook.ble_start_failed')),
      };
    }

    //  Upstream keeps the BLE mesh running as one process; DM threads are
    //  just a filtered view over `onBLEPrivateMessage`, which
    //  `BitchatBLEProvider` pushes into `useBitchatDmMessagesStore` so inbound
    //  DMs aren't dropped while this screen is closed. The store also tracks
    //  delivery status, so this transport listens to nothing here.
    case 'ble-dm': {
      if (!peerID || !nickname || !profileScope || !identityMaterial) return null;
      bitchatLog.info('bitchat.hook.ble_dm_setup', { peerID });
      return {
        listen: () => [],
        connect: () => {
          // Reuse the mesh if it's already running (no-op); otherwise start it.
          // Never stopBLE on leaving: other screens may still be using it.
          const started = startBLE({ nickname, profileScope, identityMaterial })
            .then(() => true)
            .catch(startFailed('bitchat.hook.ble_start_failed'));
          // Trigger the Noise handshake eagerly so the first message isn't delayed.
          startBLEPrivateChat(peerID).catch((err) => {
            bitchatLog.warn('bitchat.hook.ble_dm_handshake_failed', {
              peerID,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return started;
        },
      };
    }

    case 'nostr': {
      if (!geohash) return null;
      bitchatLog.info('bitchat.hook.setup', { geohash });
      return {
        listen: (append) => [
          addNostrMessageListener((event: NostrMessageEvent) => {
            if (event.geohash === geohash) append(nostrChatMessage(event, false));
          }),
        ],
        connect: (isCancelled) =>
          connectNostrGeohash(
            geohash,
            profileScope,
            isCancelled,
            'bitchat.hook.nostr_start_failed'
          ),
      };
    }

    //  DMs ride the SAME geohash subscription channel the public chat sets up
    //  (native subscribes to both kind-20000 and kind-1059 when we join a
    //  geohash). So we join the geohash here even though we only want the DM
    //  stream — public events are filtered out client-side.
    case 'nostr-dm': {
      if (!peerID || !geohash) return null;
      bitchatLog.info('bitchat.hook.nostr_dm_setup', { geohash, peerPrefix: peerID.slice(0, 8) });
      return {
        listen: (append) => [
          addNostrPrivateMessageListener((event: NostrPrivateMessageEvent) => {
            // Only surface messages from this peer into this thread.
            if (event.geohash === geohash && event.senderPubkey === peerID) {
              append(nostrChatMessage(event, true));
            }
          }),
        ],
        connect: (isCancelled) =>
          connectNostrGeohash(
            geohash,
            profileScope,
            isCancelled,
            'bitchat.hook.nostr_dm_start_failed'
          ),
      };
    }
  }
}

export function useBitChat({
  transport,
  geohash,
  peerID: dmPeerID,
}: UseBitChatOptions): UseBitChatResult {
  const nickname = useBitchatNickname();
  const profileScope = useBitchatProfileScope();
  const identityMaterial = useBitchatBLEIdentityMaterial();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [retried, setRetried] = useState<ReadonlySet<string>>(() => new Set(retriedBleDmIds));

  useVisualActivityEffect(
    useCallback(() => {
      if (transport === 'ble' || transport === 'ble-dm') return acquirePublicBLEMesh();
    }, [transport])
  );

  // Reset the buffer only when the *subscription identity* changes — i.e.
  // we're now watching a different transport / peer / geohash and the old
  // messages no longer apply. Keying state-reset off the transport wiring
  // would wipe messages on any dep churn — e.g. `nickname` resolving after
  // first render — and, for ble-dm in particular, that loss is permanent
  // because BLE has no replay path.
  useEffect(() => {
    setMessages([]);
  }, [transport, dmPeerID, geohash]);

  // The Nostr transports never read the nickname or the BLE identity, so a
  // kind:0 metadata refresh must not tear down and rebuild their subscription.
  const isBle = transport === 'ble' || transport === 'ble-dm';
  const bleNickname = isBle ? nickname : '';
  const bleIdentity = isBle ? identityMaterial : null;
  useEffect(() => {
    const wiring = wiringFor(transport, geohash, dmPeerID, profileScope, bleNickname, bleIdentity);
    if (!wiring) return;
    // A start that resolves after this chat was left must not mark it connected.
    let cancelled = false;
    const subs = wiring.listen((msg) => setMessages((prev) => appendChatMessage(prev, msg)));
    void wiring
      .connect(() => cancelled)
      .then((connected) => {
        if (connected && !cancelled) setIsConnected(true);
      });
    return () => {
      cancelled = true;
      for (const sub of subs) sub.remove();
      // No leaveGeohash — see connectNostrGeohash. The buffer reset is the
      // identity-change effect above, so a transient rebuild keeps history.
      setIsConnected(false);
    };
  }, [transport, geohash, dmPeerID, profileScope, bleNickname, bleIdentity]);

  // Subscribe to the per-peer slice of the global DM store. The selector
  // memoises by reference, so unrelated peer updates don't re-render.
  const bleDmMessages = useBitchatDmMessagesStore((state) =>
    transport === 'ble-dm' && dmPeerID ? state.byPeer[dmPeerID] : undefined
  );

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
          // BLE_DM_STUCK_TIMEOUT_MS, mark it unconfirmed (saved as `failed`,
          // reason `timeout`) so the bubble surfaces a tap-to-retry instead
          // of spinning forever.
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
            // The store's table moves only a message still sending.
            if (!useBitchatDmMessagesStore.getState().markTimedOut(messageID)) return;
            bitchatLog.warn('bitchat.hook.ble_dm_stuck', {
              peerID: dmPeerID,
              messageID,
              timeoutMs: BLE_DM_STUCK_TIMEOUT_MS,
            });
          }, BLE_DM_STUCK_TIMEOUT_MS);

          try {
            const startedAt = Date.now();
            const returnedID = await sendBLEPrivateMessage({
              peerID: dmPeerID,
              content,
              nickname,
              messageID,
            });
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
  const source: readonly BleDmMessage[] | undefined =
    transport === 'ble-dm' ? bleDmMessages : messages;
  const rows = useMemo(() => (source ?? []).map(bubbleRow), [source]);

  const retryFor = useCallback(
    (message: ChatBubbleMessage) =>
      message.deliveryStatus === 'failed' && !retried.has(message.id)
        ? () => {
            // A second tap can land before the bubble re-renders without its retry.
            if (retriedBleDmIds.has(message.id)) return;
            retriedBleDmIds.add(message.id);
            setRetried(new Set(retriedBleDmIds));
            bitchatLog.info('bitchat.screen.ble_dm_retry', { messageID: message.id });
            void sendMessage(message.content);
          }
        : undefined,
    [retried, sendMessage]
  );

  return { messages: rows, isConnected, sendMessage, retryFor };
}
