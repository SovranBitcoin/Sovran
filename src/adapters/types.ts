import type { CocoLogger } from '../logger';
import type { RecipientProfile, ScanSourceResult, URDecoderLike } from '../machine/types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonRecord = { readonly [key: string]: JsonValue };

/**
 * Clipboard adapter.
 *
 * JSON-shaped contract: text in, text-or-null out. Consumers can back this
 * with Expo, Nitro, browser APIs, or a test double without leaking that choice
 * into Colada.
 */
export interface ClipboardAdapter {
  readText?: () => Promise<string | null>;
  writeText?: (text: string) => Promise<void>;
}

/**
 * Share-sheet adapter.
 *
 * JSON-shaped contract: a small serializable payload only. Native share APIs
 * stay behind the consumer implementation.
 */
export interface ShareAdapter {
  share: (content: { message: string; url?: string; title?: string }) => Promise<void>;
}

/**
 * Camera adapter.
 *
 * JSON-shaped contract: permission is a boolean and scan output is the shared
 * ScanSourceResult discriminated union.
 */
export interface CameraAdapter {
  requestPermission?: () => Promise<boolean>;
  scanQr?: () => Promise<ScanSourceResult>;
}

/**
 * Gallery/image-picker adapter.
 *
 * JSON-shaped contract: one pick attempt returns a ScanSourceResult. Image
 * handles, file URIs, and decoder implementation details stay in the app.
 */
export interface ImagePickerAdapter {
  pickQrImage: () => Promise<ScanSourceResult>;
}

/**
 * Haptics adapter.
 *
 * JSON-shaped contract: named haptic events only. Platform-specific intensity
 * constants stay in the consumer.
 */
export interface HapticsAdapter {
  impact?: (style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid') => Promise<void> | void;
  notification?: (kind: 'success' | 'warning' | 'error') => Promise<void> | void;
  selection?: () => Promise<void> | void;
}

/**
 * Notification adapter.
 *
 * JSON-shaped contract: event name plus optional structured payload. Apps
 * decide whether this becomes a toast, local notification, banner, or no-op.
 */
export interface NotificationsAdapter {
  notify: (event: string, payload?: JsonRecord) => Promise<void> | void;
}

/**
 * Nostr adapter.
 *
 * JSON-shaped contract: nprofile/message strings and compact profile data.
 * Relay pools, NDK, nostr-tools, and cache writes remain app concerns.
 */
export interface NostrAdapter {
  sendDirectMessage?: (nprofile: string, message: string) => Promise<void>;
  resolveProfile?: (pubkey: string, signal?: AbortSignal) => Promise<RecipientProfile | null>;
}

/**
 * BLE adapter.
 *
 * JSON-shaped contract: profile-scoped identity material and opaque peer
 * snapshots. Native BLE modules remain consumer-owned.
 */
export interface BleAdapter {
  getIdentityMaterial?: () => JsonRecord | null;
  getPeerSnapshot?: (peerId: string) => Promise<JsonRecord | null>;
}

/**
 * NFC adapter.
 *
 * JSON-shaped contract: encoded payment payloads only. Session ownership and
 * native module details stay inside the consumer.
 */
export interface NfcAdapter {
  readPaymentRequest: () => Promise<string>;
  writeToken: (token: string) => Promise<void>;
  releaseSession: () => Promise<void>;
  isAvailable: () => Promise<boolean>;
}

export type ChainNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';

export interface ChainFeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

export interface ChainTransactionStatus {
  txid: string;
  confirmed: boolean;
  blockHeight?: number;
  blockHash?: string;
  confirmations: number;
}

export interface ChainAddressCounter {
  tx_count: number;
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
}

export interface ChainAddressFundingTx {
  txid: string;
  valueSats: number;
  confirmations: number;
}

export interface ChainAddressStats {
  address: string;
  chain_stats: ChainAddressCounter;
  mempool_stats: ChainAddressCounter;
  fundingTxs?: ChainAddressFundingTx[];
}

export interface ChainAddressSummary {
  address: string;
  confirmedTxCount: number;
  confirmedReceivedSats: number;
  confirmedBalanceSats: number;
  confirmedFundingConfirmations: number | null;
  unconfirmedTxCount: number;
  unconfirmedReceivedSats: number;
  unconfirmedNetSats: number;
  totalReceivedSats: number;
  explorerUrl: string;
}

/**
 * Chain adapter.
 *
 * JSON-shaped contract: addresses, transaction ids, raw transaction hex, and
 * fee/status records. mempool.space, Esplora, Electrum, or local nodes can all
 * implement this shape.
 */
export interface ChainAdapter {
  network: ChainNetwork;
  estimateFees: () => Promise<ChainFeeEstimate>;
  getAddressTransactions: (address: string) => Promise<ChainTransactionStatus[]>;
  getAddressStats?: (address: string) => Promise<ChainAddressStats>;
  getAddressSummary?: (address: string) => Promise<ChainAddressSummary>;
  getTransactionStatus: (txid: string) => Promise<ChainTransactionStatus | null>;
  broadcastTransaction: (rawTxHex: string) => Promise<{ txid: string }>;
  subscribeAddress?: (
    address: string,
    listener: (status: ChainTransactionStatus) => void,
  ) => () => void;
}

/**
 * Plain storage adapter.
 *
 * JSON-shaped contract: values are JSON serializable. Consumers choose
 * AsyncStorage, SQLite, MMKV, in-memory tests, or browser storage.
 */
export interface StorageAdapter {
  getItem: (key: string) => Promise<JsonValue | null>;
  setItem: (key: string, value: JsonValue) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

/**
 * Secure storage adapter.
 *
 * JSON-shaped contract: same as StorageAdapter plus the expectation that the
 * consumer implementation applies its platform's secure-storage policy.
 */
export interface SecureStorageAdapter extends StorageAdapter {}

/**
 * QR encoder adapter.
 *
 * JSON-shaped contract: input text returns a serializable image payload. Native
 * canvas/SVG libraries stay out of Colada.
 */
export interface QrEncoderAdapter {
  encode: (text: string) => Promise<{
    kind: 'svg' | 'pngDataUri' | 'utf8';
    data: string;
    size?: number;
  }>;
}

/**
 * QR decoder adapter.
 *
 * JSON-shaped contract: callers provide a URI/data payload and receive text or
 * null. UR assembly is supplied separately through createUrDecoder.
 */
export interface QrDecoderAdapter {
  decode: (input: {
    uri?: string;
    dataUri?: string;
    bytesBase64?: string;
  }) => Promise<string | null>;
  createUrDecoder?: () => URDecoderLike;
}

/**
 * Clock adapter.
 *
 * JSON-shaped contract: timestamps are Unix milliseconds. Timer handles stay
 * opaque to the host runtime and are intentionally not persisted.
 */
export interface ClockAdapter {
  now: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Random adapter.
 *
 * JSON-shaped contract: random bytes are returned as numeric byte arrays so a
 * consumer can back them with WebCrypto, Expo Crypto, Nitro, or tests.
 */
export interface RandomAdapter {
  bytes: (length: number) => Promise<number[]>;
  uuid?: () => string;
}

export type LoggerAdapter = CocoLogger;

export interface ColadaAdapters {
  clipboardAdapter?: ClipboardAdapter;
  shareAdapter?: ShareAdapter;
  cameraAdapter?: CameraAdapter;
  imagePickerAdapter?: ImagePickerAdapter;
  hapticsAdapter?: HapticsAdapter;
  notificationsAdapter?: NotificationsAdapter;
  nostrAdapter?: NostrAdapter;
  bleAdapter?: BleAdapter;
  nfcAdapter?: NfcAdapter;
  chainAdapter?: ChainAdapter;
  storageAdapter?: StorageAdapter;
  secureStorageAdapter?: SecureStorageAdapter;
  qrEncoderAdapter?: QrEncoderAdapter;
  qrDecoderAdapter?: QrDecoderAdapter;
  clockAdapter?: ClockAdapter;
  randomAdapter?: RandomAdapter;
  loggerAdapter?: LoggerAdapter;
}
