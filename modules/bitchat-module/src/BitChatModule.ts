import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type { NostrMessageEvent } from './types';

const NativeModule = requireNativeModule<BitChatNativeModule>('BitChat');

interface BitChatNativeModule {
  // Geohash
  encodeGeohash(latitude: number, longitude: number, precision: number): string;
  decodeGeohash(hash: string): { lat: number; lon: number };
  neighbors(hash: string): string[];
  closestRelays(latitude: number, longitude: number, count: number): Promise<string[]>;
  closestRelaysForGeohash(hash: string, count: number): Promise<string[]>;
  // BLE
  startBLE(nickname: string): Promise<void>;
  stopBLE(): Promise<void>;
  sendBLEMessage(content: string): Promise<void>;
  getBLEPeers(): BLEPeer[];
  getBLEState(): string;
  getBLEDiagnostics(): BLEDiagnostics;
  // Nostr (native — wraps upstream bitchat's NostrRelayManager + GeoRelayDirectory)
  startNostr(): Promise<void>;
  stopNostr(): Promise<void>;
  joinGeohash(hash: string): Promise<void>;
  leaveGeohash(): Promise<void>;
  sendGeohashMessage(content: string, nickname: string): Promise<void>;
  // Events
  addListener(eventName: string, listener: (event: any) => void): EventSubscription;
  removeListeners(count: number): void;
}

export interface BLEPeer {
  peerID: string;
  nickname: string;
  isConnected: boolean;
  lastSeen: number;
}

export interface BLEDiagnostics {
  isRunning: boolean;
  centralState: string;
  peripheralState: string;
  isScanning: boolean;
  isAdvertising: boolean;
  /** Peers tracked via announce-packet exchange (post-Noise-handshake). */
  peerCount: number;
  connectedPeers: number;
  /** CBPeripheral instances we're connected to as central (pre-announce). */
  connectedPeripherals: number;
  /**
   * Subset of connectedPeripherals where we completed characteristic discovery
   * and called setNotifyValue(true). The remote device's `updateValue`
   * notifications only reach us for peripherals in this count.
   */
  peripheralsSubscribed: number;
  /** CBCentral instances subscribed to our peripheral characteristic. */
  subscribedCentrals: number;
  /** Inbound writes being accumulated from centrals (long-write reassembly). */
  pendingWriteBuffers: number;
  /** Same as peerCount but raw — drift indicates tracking bugs. */
  announcedPeers: number;
  /**
   * Count of `peripheral(_:didUpdateValueFor:error:)` delegate callbacks since
   * start. 0 while peripheralsSubscribed ≥ 1 means the remote never notifies
   * us — a discovery / setNotifyValue / characteristic-property problem.
   */
  inboundNotifyCount: number;
  /** Subset of inboundNotifyCount where the delegate fired with a non-nil error. */
  inboundNotifyErrorCount: number;
  /** Subset of inboundNotifyCount where the characteristic value was nil or empty. */
  inboundNotifyEmptyCount: number;
  /**
   * Gate counters inside `handleAnnounce`. `announceReceivedCount` ticks every
   * time an announce packet enters the function. The other six track which
   * early-return gate fired; sum should roughly equal received - accepted.
   *
   * If announceReceivedCount > 0 and announceAcceptedCount stays 0, one of the
   * reject counters will reveal which gate is dropping. Most likely: sig fail
   * (protocol divergence) or unverified (unsigned announces from a peer we
   * don't have keys for).
   */
  announceReceivedCount: number;
  announceDecodeFailCount: number;
  announceSenderMismatchCount: number;
  announceStaleCount: number;
  announceSigFailCount: number;
  announceUnverifiedCount: number;
  announceAcceptedCount: number;
}

export interface BLEMessageEvent {
  id: string;
  content: string;
  sender: string;
  senderPeerID: string;
  timestamp: number;
  isPrivate: boolean;
}

// --- Geohash ---

export function nativeEncodeGeohash(lat: number, lon: number, precision: number): string {
  return NativeModule.encodeGeohash(lat, lon, precision);
}

export function nativeDecodeGeohash(hash: string): { lat: number; lon: number } {
  return NativeModule.decodeGeohash(hash);
}

export function getNeighbors(hash: string): string[] {
  return NativeModule.neighbors(hash);
}

export function getClosestRelays(lat: number, lon: number, count: number): Promise<string[]> {
  return NativeModule.closestRelays(lat, lon, count);
}

export function getClosestRelaysForGeohash(hash: string, count: number): Promise<string[]> {
  return NativeModule.closestRelaysForGeohash(hash, count);
}

// --- BLE Mesh ---

export function startBLE(nickname: string): Promise<void> {
  return NativeModule.startBLE(nickname);
}

export function stopBLE(): Promise<void> {
  return NativeModule.stopBLE();
}

export function sendBLEMessage(content: string): Promise<void> {
  return NativeModule.sendBLEMessage(content);
}

export function getBLEPeers(): BLEPeer[] {
  return NativeModule.getBLEPeers();
}

export function getBLEState(): string {
  return NativeModule.getBLEState();
}

export function getBLEDiagnostics(): BLEDiagnostics {
  return NativeModule.getBLEDiagnostics();
}

export function addBLEMessageListener(listener: (event: BLEMessageEvent) => void): EventSubscription {
  return NativeModule.addListener('onBLEMessage', listener);
}

export function addBLEPeerListener(listener: (event: any) => void): EventSubscription {
  return NativeModule.addListener('onBLEPeerUpdate', listener);
}

export function addBLEStateListener(listener: (event: { state: string }) => void): EventSubscription {
  return NativeModule.addListener('onBLEStateChanged', listener);
}

// --- Nostr ---

export function startNostr(): Promise<void> {
  return NativeModule.startNostr();
}

export function stopNostr(): Promise<void> {
  return NativeModule.stopNostr();
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

export function addNostrMessageListener(
  listener: (event: NostrMessageEvent) => void
): EventSubscription {
  return NativeModule.addListener('onNostrMessage', listener);
}
