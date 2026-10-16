import type { CocoLogger } from "../logger";
import type {
  RecipientProfile,
  ScanSourceResult,
  URDecoderLike,
} from "../machine/types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };
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
  share: (content: {
    message: string;
    url?: string;
    title?: string;
  }) => Promise<void>;
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
 * Nostr adapter.
 *
 * JSON-shaped contract: nprofile/message strings and compact profile data.
 * Relay pools, NDK, nostr-tools, and cache writes remain app concerns.
 */
export interface NostrAdapter {
  sendDirectMessage?: (dm: { nprofile: string; message: string }) => Promise<void>;
  resolveProfile?: (
    pubkey: string,
    signal?: AbortSignal,
  ) => Promise<RecipientProfile | null>;
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

export type ChainNetwork = "mainnet" | "testnet" | "signet" | "regtest";

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
  /** Explorer page for the deposit ADDRESS (always available). */
  explorerUrl: string;
  /**
   * Explorer page for the specific funding TRANSACTION whose depth
   * `confirmedFundingConfirmations` reports (the least-confirmed confirmed
   * deposit). Null until a confirmed funding tx is known — callers fall back
   * to `explorerUrl`.
   */
  transactionExplorerUrl: string | null;
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
  getAddressTransactions: (
    address: string,
  ) => Promise<ChainTransactionStatus[]>;
  getAddressStats?: (address: string) => Promise<ChainAddressStats>;
  getAddressSummary?: (address: string) => Promise<ChainAddressSummary>;
  getTransactionStatus: (
    txid: string,
  ) => Promise<ChainTransactionStatus | null>;
  broadcastTransaction: (rawTxHex: string) => Promise<{ txid: string }>;
  subscribeAddress?: (
    address: string,
    listener: (status: ChainTransactionStatus) => void,
  ) => () => void;
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

export type LoggerAdapter = CocoLogger;

export interface ColadaAdapters {
  clipboardAdapter?: ClipboardAdapter;
  shareAdapter?: ShareAdapter;
  imagePickerAdapter?: ImagePickerAdapter;
  nostrAdapter?: NostrAdapter;
  nfcAdapter?: NfcAdapter;
  chainAdapter?: ChainAdapter;
  qrDecoderAdapter?: QrDecoderAdapter;
  loggerAdapter?: LoggerAdapter;
}
