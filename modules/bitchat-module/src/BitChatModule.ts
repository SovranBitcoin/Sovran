import { Linking, Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  BLEDeliveryStatusEvent,
  BLEDmContact,
  BLEMessageEvent,
  BLENutPayloadEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  BitchatBLEIdentityMaterial,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './types';
import {
  NUT_PAYLOAD_TYPE,
  base64ToBytes,
  bytesToBase64,
  decodeRequest,
  encodeSolicit,
  generateSolicitId,
  solicitIdHex,
} from './nutDropProtocol';

/**
 * The peer shape native actually returns. The deprecated announced-key fields
 * still present on `BLEPeer` are synthesized in the `getBLEPeers` wrapper —
 * the v2 beacon carries no key material, so they can never be truthy.
 */
type NativeBLEPeer = Omit<BLEPeer, 'supportsP2pkEcash' | 'ecashCapabilities' | 'p2pkPubkeyHex'>;

interface NativeNutPayloadEvent {
  peerID: string;
  payloadBase64: string;
  timestamp: number;
}

interface BitChatNativeModule {
  // BLE
  startBLE(
    nickname: string,
    profileScope: string,
    noisePrivateKeyHex: string,
    signingPrivateKeyHex: string,
    p2pkPubkeyHex: string
  ): Promise<void>;
  sendBLEMessage(content: string): Promise<void>;
  startBLEPrivateChat(peerID: string): Promise<void>;
  resetBLEPrivateChat(peerID: string): Promise<void>;
  sendBLEPrivateMessage(
    peerID: string,
    content: string,
    nickname: string,
    messageID: string
  ): Promise<string>;
  getBLEPeers(): NativeBLEPeer[];
  getBLEDmHistory(profileScope: string): BLEDmContact[];
  getBLEState(): string;
  nutSendPayload(peerID: string, payloadBase64: string): Promise<void>;
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
  sendGeohashPrivateMessage(recipientPubkey: string, content: string): Promise<void>;
  // Events — `event` is unknown at the bridge boundary; typed wrappers below
  // cast to the per-event payload that the native side actually dispatches.
  addListener(eventName: string, listener: (event: unknown) => void): EventSubscription;
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

export function startBLE(
  nickname: string,
  profileScope: string,
  identityMaterial: BitchatBLEIdentityMaterial
): Promise<void> {
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
        // Cashu P2PK lock target announced in the ecash capability TLV:
        // "02" + the profile's x-only Nostr pubkey (NUT-11 / Minibits
        // convention — BIP340 signing ignores Y parity).
        `02${identityMaterial.nostrPubkey}`
      )
    : unavailable();
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
export function sendBLEPrivateMessage(
  peerID: string,
  content: string,
  nickname: string,
  messageID: string
): Promise<string> {
  return NativeModule
    ? NativeModule.sendBLEPrivateMessage(peerID, content, nickname, messageID)
    : unavailable();
}

export function addBLEPrivateMessageListener(
  listener: (event: BLEPrivateMessageEvent) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEPrivateMessage', listener as (e: unknown) => void);
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
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEDeliveryStatus', listener as (e: unknown) => void);
}

export function getBLEPeers(): BLEPeer[] {
  if (!NativeModule) return [];
  // Deprecated announced-key fields synthesized until the S3 rewire: the v2
  // beacon carries no key material, so the announced-key P2PK path can never
  // apply — every peer reads as bearer-only to the legacy send flow.
  return NativeModule.getBLEPeers().map((peer) => ({
    ...peer,
    supportsP2pkEcash: false,
    ecashCapabilities: 0,
  }));
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

export function addBLEMessageListener(
  listener: (event: BLEMessageEvent) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEMessage', listener as (e: unknown) => void);
}

export function addBLEPeerListener(listener: (event: BLEPeerEvent) => void): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEPeerUpdate', listener as (e: unknown) => void);
}

export function addBLEStateListener(
  listener: (event: { state: string }) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEStateChanged', listener as (e: unknown) => void);
}

// --- Nut Drop NUT-18 exchange (vendor Noise payloads 0xA0–0xA3) ---

const SOLICIT_TIMEOUT_MS = 10_000;
const SOLICIT_RETRIES = 1;

interface PendingSolicit {
  peerID: string;
  resolve: (creq: string) => void;
}

/** Outstanding solicits keyed by solicitId hex; resolved by 0xA1 responses. */
const pendingSolicits = new Map<string, PendingSolicit>();
let solicitSubscription: EventSubscription | null = null;

function ensureSolicitSubscription(): void {
  if (solicitSubscription || !NativeModule) return;
  solicitSubscription = NativeModule.addListener('onNutPayload', ((event: NativeNutPayloadEvent) => {
    const payload = base64ToBytes(event.payloadBase64);
    if (!payload || payload[0] !== NUT_PAYLOAD_TYPE.request) return;
    const request = decodeRequest(payload);
    if (!request) return;
    const pending = pendingSolicits.get(solicitIdHex(request.solicitId));
    // The creq must come from the peer we solicited — a matching id from
    // anyone else is foreign/forged content and drops.
    if (!pending || pending.peerID !== event.peerID) return;
    pending.resolve(request.creq);
  }) as (e: unknown) => void);
}

function pruneSolicitSubscription(): void {
  if (pendingSolicits.size > 0 || !solicitSubscription) return;
  solicitSubscription.remove();
  solicitSubscription = null;
}

/**
 * Send a raw Nut Drop vendor Noise payload (full typed bytes from
 * `nutDropProtocol.ts`, type byte included) to a peer. Requires an
 * established Noise session — call `startBLEPrivateChat` first; without one
 * iOS queues behind the handshake while Android drops the send (the solicit
 * timeout absorbs either).
 */
export function nutSendPayload(peerID: string, payload: Uint8Array): Promise<void> {
  return NativeModule
    ? NativeModule.nutSendPayload(peerID, bytesToBase64(payload))
    : unavailable();
}

/**
 * Subscribe to inbound Nut Drop vendor Noise payloads (all types). Raw bytes
 * — decode with `nutDropProtocol.ts`. Events with undecodable base64 are
 * dropped. The 0xA1 responses consumed by `nutSolicit` still appear here;
 * payload semantics and dedup live with the consumer (colada transport).
 */
export function addNutPayloadListener(
  listener: (event: BLENutPayloadEvent) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onNutPayload', ((event: NativeNutPayloadEvent) => {
    const payload = base64ToBytes(event.payloadBase64);
    if (!payload || payload.length === 0) return;
    listener({ peerID: event.peerID, payload, timestamp: event.timestamp });
  }) as (e: unknown) => void);
}

/**
 * Ask `peerID` for a single-use NUT-18 payment request and resolve with the
 * serialized `creq…` string. Sends a 0xA0 solicit and correlates the 0xA1
 * response by solicitId; 10s timeout with one retry (same solicitId, so a
 * slow response to the first attempt still correlates instead of racing a
 * fresh id). Rejects on timeout — callers must treat that as "couldn't
 * confirm receiver", never as a downgraded yes.
 */
export async function nutSolicit(
  peerID: string,
  options?: { senderOffline?: boolean }
): Promise<string> {
  if (!NativeModule) return unavailable();
  const native = NativeModule;
  const solicitId = generateSolicitId();
  const key = solicitIdHex(solicitId);
  const payloadBase64 = bytesToBase64(
    encodeSolicit({ solicitId, senderOffline: options?.senderOffline ?? false })
  );

  for (let attempt = 0; attempt <= SOLICIT_RETRIES; attempt++) {
    const creq = await new Promise<string | null>((resolve, reject) => {
      const settle = (value: string | null) => {
        clearTimeout(timer);
        pendingSolicits.delete(key);
        pruneSolicitSubscription();
        resolve(value);
      };
      const timer = setTimeout(() => settle(null), SOLICIT_TIMEOUT_MS);
      pendingSolicits.set(key, { peerID, resolve: settle });
      ensureSolicitSubscription();
      native.nutSendPayload(peerID, payloadBase64).catch((err: unknown) => {
        clearTimeout(timer);
        pendingSolicits.delete(key);
        pruneSolicitSubscription();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    if (creq !== null) return creq;
  }
  throw new Error(`NUT-18 solicit to peer ${peerID} timed out`);
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
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onBLEBackgroundTaskExpiring', listener as (e: unknown) => void);
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
export function sendGeohashPrivateMessage(recipientPubkey: string, content: string): Promise<void> {
  return NativeModule
    ? NativeModule.sendGeohashPrivateMessage(recipientPubkey, content)
    : unavailable();
}

export function addNostrMessageListener(
  listener: (event: NostrMessageEvent) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onNostrMessage', listener as (e: unknown) => void);
}

export function addNostrPrivateMessageListener(
  listener: (event: NostrPrivateMessageEvent) => void
): EventSubscription {
  if (!NativeModule) return NOOP_SUBSCRIPTION;
  return NativeModule.addListener('onNostrPrivateMessage', listener as (e: unknown) => void);
}
