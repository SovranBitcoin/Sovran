import { Linking, Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  BLEDeliveryStatusEvent,
  BLEDmContact,
  BLEMessageEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPeerIdentityEvent,
  BLEPrivateMessageEvent,
  BitchatBLEIdentityMaterial,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './types';
import {
  readBLEBackgroundTaskExpiring,
  readBLEDeliveryStatus,
  readBLEMessage,
  readBLEPeerIdentity,
  readBLEPeerUpdate,
  readBLEPrivateMessage,
  readBLEState,
  readNostrMessage,
  readNostrPrivateMessage,
} from './nativeEvents';

type BitChatEventName =
  | 'onBLEMessage'
  | 'onBLEPrivateMessage'
  | 'onBLEPeerIdentity'
  | 'onBLEDeliveryStatus'
  | 'onBLEPeerUpdate'
  | 'onBLEStateChanged'
  | 'onBLEBackgroundTaskExpiring'
  | 'onNostrMessage'
  | 'onNostrPrivateMessage';

interface BitChatNativeModule {
  // BLE
  startBLE(
    nickname: string,
    profileScope: string,
    noisePrivateKeyHex: string,
    signingPrivateKeyHex: string,
    p2pkPubkeyHex: string,
    creq: string | null,
    walletDiscovery: boolean
  ): Promise<void>;
  stopBLE(): Promise<void>;
  sendBLEMessage(content: string): Promise<void>;
  startBLEPrivateChat(peerID: string): Promise<void>;
  resetBLEPrivateChat(peerID: string): Promise<void>;
  sendBLEPrivateMessage(
    peerID: string,
    content: string,
    nickname: string,
    messageID: string
  ): Promise<string>;
  sendBLEFavorite(peerID: string, isFavorite: boolean): Promise<void>;
  getBLEPeers(): BLEPeer[];
  getBLEDmHistory(profileScope: string): BLEDmContact[];
  getBLEState(): string;
  bitchatVendorVersion(): string;
  beginBLEBackgroundTask(name: string): Promise<number>;
  endBLEBackgroundTask(handle: number): Promise<void>;
  // Bluetooth helpers — implemented natively on Android only; the JS wrappers
  // below provide the iOS fallbacks.
  requestEnableBluetooth?(): Promise<boolean>;
  openBluetoothSettings?(): Promise<void>;
  // Nostr (native — wraps upstream bitchat's NostrRelayManager + GeoRelayDirectory)
  startNostr(profileScope: string): Promise<void>;
  joinGeohash(hash: string): Promise<void>;
  leaveGeohash(): Promise<void>;
  sendGeohashMessage(content: string, nickname: string): Promise<void>;
  sendGeohashPrivateMessage(recipientNostrPubkeyHex: string, content: string): Promise<void>;
  // Events. A payload is whatever the native side sent: it is `unknown` here
  // and only reaches app code through a reader in `nativeEvents.ts`.
  addListener(eventName: BitChatEventName, listener: (event: unknown) => void): EventSubscription;
  removeListeners(count: number): void;
}

// Native implementations exist for both apple and android
// (expo-module.config.json platforms). Other platforms (web) resolve to
// `null` and every export degrades gracefully.
const NativeModule: BitChatNativeModule | null =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireNativeModule<BitChatNativeModule>('BitChat')
    : null;

class BitChatUnavailableError extends Error {
  constructor() {
    super('BitChat native module is unavailable on this platform');
    this.name = 'BitChatUnavailableError';
  }
}

const NOOP_SUBSCRIPTION: EventSubscription = { remove: () => {} };

/** Subscribe to a native event; a payload its reader turns down is dropped. */
function listen<T>(
  eventName: BitChatEventName,
  read: (raw: unknown) => T | null,
  listener: (event: T) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener(eventName, (raw) => {
    const event = read(raw);
    if (event !== null) listener(event);
  });
}

function unavailable(): Promise<never> {
  return Promise.reject(new BitChatUnavailableError());
}

// --- BLE Mesh ---

const KEY_HEX_RE = /^[0-9a-f]{64}$/;

function validateBLEIdentityMaterial(
  identityMaterial: BitchatBLEIdentityMaterial | null | undefined
): void {
  if (!identityMaterial) {
    throw new Error('BitChat identity material unavailable');
  }
  if (identityMaterial.version !== 'sovran-bitchat-ble-v1') {
    throw new Error('BitChat identity material has an unsupported version');
  }
  if (!KEY_HEX_RE.test(identityMaterial.nostrPubkey)) {
    throw new Error('BitChat Nostr identity material is invalid');
  }
  if (!KEY_HEX_RE.test(identityMaterial.noisePrivateKeyHex)) {
    throw new Error('BitChat noise identity material is invalid');
  }
  if (!KEY_HEX_RE.test(identityMaterial.signingPrivateKeyHex)) {
    throw new Error('BitChat signing identity material is invalid');
  }
}

/** What a BLE start needs. Named, so a nickname, a scope and a request cannot be swapped. */
interface StartBLERequest {
  nickname: string;
  profileScope: string;
  identityMaterial: BitchatBLEIdentityMaterial;
  /** Our standing NUT-18 payment request; null or absent until mints load. */
  creq?: string | null;
}

function startNativeBLE({
  nickname,
  profileScope,
  identityMaterial,
  creq,
}: StartBLERequest): Promise<void> {
  try {
    validateBLEIdentityMaterial(identityMaterial);
  } catch (err) {
    return Promise.reject(err);
  }
  return NativeModule
    ? NativeModule.startBLE(
        nickname,
        profileScope,
        identityMaterial.noisePrivateKeyHex,
        identityMaterial.signingPrivateKeyHex,
        // Native favorite identity supports explicit chat interaction only.
        // Payment eligibility is proved by signed capabilities in JS.
        `02${identityMaterial.nostrPubkey}`,
        // Our standing NUT-18 payment request (accepted mints + P2PK lock key),
        // built in JS from the user's trusted mints. null until mints load.
        creq ?? null,
        publicMeshLeases.size === 0
      )
    : unavailable();
}

// Serialize ownership changes. A profile teardown cannot stop a newer start.
let lifecycle: Promise<void> = Promise.resolve();
let currentStart: StartBLERequest | null = null;
const publicMeshLeases = new Set<symbol>();
function enqueueLifecycle(action: () => Promise<void>): Promise<void> {
  const next = lifecycle.catch(() => undefined).then(action);
  lifecycle = next;
  return next;
}
export function startBLE(request: StartBLERequest): Promise<void> {
  currentStart = request;
  return enqueueLifecycle(() => startNativeBLE(request));
}
export function stopBLE(): Promise<void> {
  currentStart = null;
  return enqueueLifecycle(() => NativeModule?.stopBLE() ?? Promise.resolve());
}
export function isPublicBLEMesh(): boolean {
  return publicMeshLeases.size > 0;
}
/** Public chat is an explicit lease; ordinary wallet discovery never joins it. */
export function acquirePublicBLEMesh(): () => void {
  const lease = Symbol('public mesh');
  publicMeshLeases.add(lease);
  if (currentStart) void startBLE(currentStart).catch(() => undefined);
  return () => {
    publicMeshLeases.delete(lease);
    if (currentStart) void startBLE(currentStart).catch(() => undefined);
  };
}

export function sendBLEMessage(content: string): Promise<void> {
  return NativeModule ? NativeModule.sendBLEMessage(content) : unavailable();
}

/**
 * Prepare a BLE private chat. Triggers the Noise XX handshake if no session
 * exists yet. Safe to call repeatedly — no-op once a session is established.
 */
export function startBLEPrivateChat(peerID: string): Promise<void> {
  return NativeModule ? NativeModule.startBLEPrivateChat(peerID) : unavailable();
}

/**
 * Clear the Noise session for `peerID`. The next outbound DM will trigger a
 * fresh XX handshake. Use this when the JS-side watchdog detects a stuck
 * `sending` message — the session is likely invalidated. Does not drain
 * upstream's pending-message queue; the JS store should mark stuck sends
 * `failed` so they don't double-send when the new handshake completes.
 */
export function resetBLEPrivateChat(peerID: string): Promise<void> {
  return NativeModule ? NativeModule.resetBLEPrivateChat(peerID) : unavailable();
}

/**
 * Send a Noise-encrypted 1:1 message over BLE mesh. If no session exists,
 * upstream bitchat queues the message and triggers a handshake automatically.
 * `nickname` is OUR nickname — upstream stamps it into the message for the
 * recipient's display. `messageID` is generated by the caller so the
 * optimistic chat bubble and later `onBLEDeliveryStatus` events
 * (sending / sent / delivered / failed) can be correlated on a single key.
 * Returns the same messageID for ergonomic chaining.
 */
export function sendBLEPrivateMessage({
  peerID,
  content,
  nickname,
  messageID,
}: {
  peerID: string;
  content: string;
  nickname: string;
  messageID: string;
}): Promise<string> {
  return NativeModule
    ? NativeModule.sendBLEPrivateMessage(peerID, content, nickname, messageID)
    : unavailable();
}

export function addBLEPrivateMessageListener(
  listener: (event: BLEPrivateMessageEvent) => void
): EventSubscription {
  return listen('onBLEPrivateMessage', readBLEPrivateMessage, (event) => {
    if (event.profileScope && event.profileScope === currentStart?.profileScope) listener(event);
  });
}

/**
 * Hand a peer our Nostr identity via bitchat's native favorite notification
 * (`[FAVORITED]:<npub>:<creq>`). This is an explicit chat action, never
 * wallet discovery or evidence that a peer controls the advertised key. If no Noise
 * session exists yet the native side defers the send until the handshake
 * completes.
 */
export function sendBLEFavorite(peerID: string, isFavorite: boolean): Promise<void> {
  return NativeModule ? NativeModule.sendBLEFavorite(peerID, isFavorite) : unavailable();
}

/**
 * Fires when a peer hands us their Nostr identity over the native favorite
 * channel. iOS emits this immediately; on both platforms the same value also
 * appears on the polled `BLEPeer.nostrPubkeyHex` / `BLEPeer.creq`. Use it to
 * mark a peer ready without waiting for the next peer poll.
 */
export function addBLEPeerIdentityListener(
  listener: (event: BLEPeerIdentityEvent) => void
): EventSubscription {
  return listen('onBLEPeerIdentity', readBLEPeerIdentity, listener);
}

/**
 * Subscribe to delivery-status transitions for outbound BLE DMs. Each event
 * carries the same `messageID` originally passed to `sendBLEPrivateMessage`.
 * Subscribe once at app-level so events aren't lost while the DM screen
 * isn't mounted.
 */
export function addBLEDeliveryStatusListener(
  listener: (event: BLEDeliveryStatusEvent) => void
): EventSubscription {
  return listen('onBLEDeliveryStatus', readBLEDeliveryStatus, listener);
}

export function getBLEPeers(): BLEPeer[] {
  return NativeModule ? NativeModule.getBLEPeers() : [];
}

/**
 * Returns the persisted 1:1 DM-peer history (peerID + best-known nickname +
 * last activity timestamp). Survives app restarts — fed by both inbound and
 * outbound BLE DMs in the native bridge. Empty array on first launch before
 * any DM has flowed.
 */
export function getBLEDmHistory(profileScope: string): BLEDmContact[] {
  return NativeModule && profileScope ? NativeModule.getBLEDmHistory(profileScope) : [];
}

export function getBLEState(): string {
  return NativeModule ? NativeModule.getBLEState() : 'unavailable';
}

/** Short SHA of the vendored bitchat submodule this native build compiled from.
 * Logged at startBLE (`bitchat.peers.ble_start_ok`) so a stale build — e.g. one
 * predating a fragmentation fix — is verifiable from log.txt. */
export function bitchatVendorVersion(): string {
  try {
    return NativeModule ? NativeModule.bitchatVendorVersion() : 'unavailable';
  } catch {
    return 'unknown';
  }
}

export function addBLEMessageListener(
  listener: (event: BLEMessageEvent) => void
): EventSubscription {
  return listen('onBLEMessage', readBLEMessage, listener);
}

export function addBLEPeerListener(listener: (event: BLEPeerEvent) => void): EventSubscription {
  return listen('onBLEPeerUpdate', readBLEPeerUpdate, listener);
}

export function addBLEStateListener(
  listener: (event: { state: string }) => void
): EventSubscription {
  return listen('onBLEStateChanged', readBLEState, listener);
}

// --- Background execution ---

/**
 * Begin an iOS background-task assertion so a network call (e.g. the Nut
 * Drop auto-redeem mint swap) can finish after a BLE background wake (~30s
 * budget). Returns an opaque handle, or -1 when unavailable (Android — the
 * mesh foreground service already keeps the process alive — or refused by
 * the system). Always pair with `endBLEBackgroundTask` in a `finally`.
 */
export function beginBLEBackgroundTask(name: string): Promise<number> {
  return NativeModule ? NativeModule.beginBLEBackgroundTask(name) : Promise.resolve(-1);
}

export function endBLEBackgroundTask(handle: number): Promise<void> {
  if (!NativeModule || handle < 0) return Promise.resolve();
  return NativeModule.endBLEBackgroundTask(handle);
}

/**
 * Fires when iOS reclaims a `beginBLEBackgroundTask` assertion before it was
 * ended — the in-flight work is about to be suspended; rely on persisted
 * state to resume on next foreground.
 */
export function addBLEBackgroundTaskExpiringListener(
  listener: (event: { handle: number }) => void
): EventSubscription {
  return listen('onBLEBackgroundTaskExpiring', readBLEBackgroundTaskExpiring, listener);
}

// --- Bluetooth helpers ---

/**
 * Ask the OS to enable Bluetooth. Android shows the system
 * "Allow Sovran to turn on Bluetooth?" dialog (ACTION_REQUEST_ENABLE) and
 * resolves with whether the adapter ended up enabled. iOS has no such
 * affordance — resolves `false` so callers fall back to `openBluetoothSettings`.
 */
export function requestEnableBluetooth(): Promise<boolean> {
  if (NativeModule?.requestEnableBluetooth) {
    return NativeModule.requestEnableBluetooth();
  }
  return Promise.resolve(false);
}

/**
 * Open the closest thing to Bluetooth settings the platform allows:
 * Android jumps straight to the system Bluetooth settings screen; iOS has no
 * public deep link to Bluetooth settings, so it opens the app's settings page
 * (the legal target), where the Bluetooth permission toggle lives.
 */
export function openBluetoothSettings(): Promise<void> {
  if (NativeModule?.openBluetoothSettings) {
    return NativeModule.openBluetoothSettings();
  }
  return Linking.openSettings();
}

// --- Nostr ---

export function startNostr(profileScope: string): Promise<void> {
  return NativeModule ? NativeModule.startNostr(profileScope) : unavailable();
}

export function joinGeohash(hash: string): Promise<void> {
  return NativeModule ? NativeModule.joinGeohash(hash) : unavailable();
}

export function leaveGeohash(): Promise<void> {
  return NativeModule ? NativeModule.leaveGeohash() : unavailable();
}

export function sendGeohashMessage(content: string, nickname: string): Promise<void> {
  return NativeModule ? NativeModule.sendGeohashMessage(content, nickname) : unavailable();
}

/**
 * Send a NIP-17 gift-wrapped DM to another participant in the currently-
 * joined geohash. The recipient is addressed by the Nostr hex pubkey
 * observed on their public geohash messages (`senderPubkey` from
 * `onNostrMessage` events).
 */
export function sendGeohashPrivateMessage(
  recipientNostrPubkeyHex: string,
  content: string
): Promise<void> {
  return NativeModule
    ? NativeModule.sendGeohashPrivateMessage(recipientNostrPubkeyHex, content)
    : unavailable();
}

export function addNostrMessageListener(
  listener: (event: NostrMessageEvent) => void
): EventSubscription {
  return listen('onNostrMessage', readNostrMessage, listener);
}

export function addNostrPrivateMessageListener(
  listener: (event: NostrPrivateMessageEvent) => void
): EventSubscription {
  return listen('onNostrPrivateMessage', readNostrPrivateMessage, listener);
}
