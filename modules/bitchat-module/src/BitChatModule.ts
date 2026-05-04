import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  BLEDiagnostics,
  BLEMessageEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './types';

const NativeModule = requireNativeModule<BitChatNativeModule>('BitChat');

interface BitChatNativeModule {
  // BLE
  startBLE(nickname: string): Promise<void>;
  sendBLEMessage(content: string): Promise<void>;
  startBLEPrivateChat(peerID: string): Promise<void>;
  sendBLEPrivateMessage(peerID: string, content: string, nickname: string): Promise<void>;
  getBLEPeers(): BLEPeer[];
  getBLEState(): string;
  // Nostr (native — wraps upstream bitchat's NostrRelayManager + GeoRelayDirectory)
  startNostr(): Promise<void>;
  joinGeohash(hash: string): Promise<void>;
  leaveGeohash(): Promise<void>;
  sendGeohashMessage(content: string, nickname: string): Promise<void>;
  sendGeohashPrivateMessage(recipientPubkey: string, content: string): Promise<void>;
  // Events — `event` is unknown at the bridge boundary; typed wrappers below
  // cast to the per-event payload that the native side actually dispatches.
  addListener(eventName: string, listener: (event: unknown) => void): EventSubscription;
  removeListeners(count: number): void;
}

// --- BLE Mesh ---

export function startBLE(nickname: string): Promise<void> {
  return NativeModule.startBLE(nickname);
}

export function sendBLEMessage(content: string): Promise<void> {
  return NativeModule.sendBLEMessage(content);
}

/**
 * Prepare a BLE private chat. Triggers the Noise XX handshake if no session
 * exists yet. Safe to call repeatedly — no-op once a session is established.
 */
export function startBLEPrivateChat(peerID: string): Promise<void> {
  return NativeModule.startBLEPrivateChat(peerID);
}

/**
 * Send a Noise-encrypted 1:1 message over BLE mesh. If no session exists,
 * upstream bitchat queues the message and triggers a handshake automatically.
 * `nickname` is OUR nickname — upstream stamps it into the message for the
 * recipient's display.
 */
export function sendBLEPrivateMessage(
  peerID: string,
  content: string,
  nickname: string
): Promise<void> {
  return NativeModule.sendBLEPrivateMessage(peerID, content, nickname);
}

export function addBLEPrivateMessageListener(
  listener: (event: BLEPrivateMessageEvent) => void
): EventSubscription {
  return NativeModule.addListener('onBLEPrivateMessage', listener as (e: unknown) => void);
}

export function getBLEPeers(): BLEPeer[] {
  return NativeModule.getBLEPeers();
}

export function getBLEState(): string {
  return NativeModule.getBLEState();
}

export function addBLEMessageListener(
  listener: (event: BLEMessageEvent) => void
): EventSubscription {
  return NativeModule.addListener('onBLEMessage', listener as (e: unknown) => void);
}

export function addBLEPeerListener(listener: (event: BLEPeerEvent) => void): EventSubscription {
  return NativeModule.addListener('onBLEPeerUpdate', listener as (e: unknown) => void);
}

export function addBLEStateListener(
  listener: (event: { state: string }) => void
): EventSubscription {
  return NativeModule.addListener('onBLEStateChanged', listener as (e: unknown) => void);
}

// --- Nostr ---

export function startNostr(): Promise<void> {
  return NativeModule.startNostr();
}

export function joinGeohash(hash: string): Promise<void> {
  return NativeModule.joinGeohash(hash);
}

export function leaveGeohash(): Promise<void> {
  return NativeModule.leaveGeohash();
}

export function sendGeohashMessage(content: string, nickname: string): Promise<void> {
  return NativeModule.sendGeohashMessage(content, nickname);
}

/**
 * Send a NIP-17 gift-wrapped DM to another participant in the currently-
 * joined geohash. The recipient is addressed by the Nostr hex pubkey
 * observed on their public geohash messages (`senderPubkey` from
 * `onNostrMessage` events).
 */
export function sendGeohashPrivateMessage(recipientPubkey: string, content: string): Promise<void> {
  return NativeModule.sendGeohashPrivateMessage(recipientPubkey, content);
}

export function addNostrMessageListener(
  listener: (event: NostrMessageEvent) => void
): EventSubscription {
  return NativeModule.addListener('onNostrMessage', listener as (e: unknown) => void);
}

export function addNostrPrivateMessageListener(
  listener: (event: NostrPrivateMessageEvent) => void
): EventSubscription {
  return NativeModule.addListener('onNostrPrivateMessage', listener as (e: unknown) => void);
}

// Re-export the BLE payload types so callers can keep importing from
// 'bitchat-module' without reaching into ./src/types directly.
export type { BLEDiagnostics, BLEMessageEvent, BLEPeer, BLEPeerEvent };
