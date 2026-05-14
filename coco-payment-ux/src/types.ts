// ---------------------------------------------------------------------------
// Detectors — provided by the wallet to enable protocol-specific parsing.
// The library performs normalization and orchestration; detectors handle
// the actual decoding of each payment format.
// ---------------------------------------------------------------------------

export interface Detectors {
  isValidEcashToken(value: string): boolean;
  isPaymentRequest(value: string): boolean;
  isLightningInvoice(value: string): boolean;
  isLightningAddress(value: string): boolean;
  isLnurlp(value: string): boolean;
  getLightningAmount(invoice: string): number | null;
  getPaymentRequestInfo(value: string): PaymentRequestInfo | null;
  parseNpub(value: string): string | null;
}

export interface PaymentRequestInfo {
  mints: string[];
  amount: number | undefined;
  unit: string;
  transports?: PaymentRequestTransport[];
}

export interface PaymentRequestTransport {
  type: string;
  target: string;
}

// ---------------------------------------------------------------------------
// Wallet Context — runtime state the wallet provides so the library can
// make recommendation and routing decisions without owning storage.
// ---------------------------------------------------------------------------

export interface WalletContext {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
  preferredMintUrl?: string;
  /**
   * Per-mint proof amounts. Keys are mint URLs, values are arrays of
   * individual proof denominations. Routing uses this to detect whether
   * a send amount is constructible without a swap and emit a
   * `selectProofs` step when it isn't.
   */
  proofAmounts: Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Parsed Payment Input
// ---------------------------------------------------------------------------

export type PaymentOptionKind =
  | 'ecashToken'
  | 'paymentRequest'
  | 'lightningInvoice'
  | 'lightningAddress'
  | 'lnurlp';

export interface PaymentOption {
  kind: PaymentOptionKind;
  value: string;
  amount?: number | null;
  source: 'standalone' | 'bip321';
  paramKey?: string | null;
}

export interface Bip321Container {
  address: string | null;
  amountBtc: string | null;
  label: string | null;
  message: string | null;
  params: Record<string, string[]>;
  unsupportedParamKeys: string[];
}

export type ParsedInputType = 'ur' | 'payment' | 'mintUrl' | 'npub' | 'bip321' | 'unknown';

export interface ParsedPaymentInput {
  raw: string;
  normalized: string;
  type: ParsedInputType;
  container: 'standalone' | 'bip321' | null;
  options: PaymentOption[];
  bip321?: Bip321Container;
  mintUrl?: string;
  npub?: string;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Option Annotation
// ---------------------------------------------------------------------------

export type OptionStatus = 'recommended' | 'available' | 'disabled';

export interface AnnotatedOption {
  option: PaymentOption;
  status: OptionStatus;
  reason: import('./formatting/locales').LocalizedReason | null;
}

// ---------------------------------------------------------------------------
// Resolved Intent — what the wallet should do based on the parsed input.
// ---------------------------------------------------------------------------

export type ResolvedIntent =
  | { type: 'receiveToken'; option: PaymentOption }
  | { type: 'sendPaymentRequest'; option: PaymentOption; info: PaymentRequestInfo }
  | { type: 'meltLightningInvoice'; option: PaymentOption }
  | { type: 'meltLightningAddress'; option: PaymentOption }
  | { type: 'meltLnurlp'; option: PaymentOption }
  | { type: 'openMint'; url: string }
  | { type: 'openProfile'; npub: string }
  | { type: 'chooseOption'; options: AnnotatedOption[] }
  | { type: 'ignore'; reason: import('./formatting/locales').LocalizedReason };

export interface AmountEntryConstraints {
  paymentRequest?: string;
  meltTarget?: string;
  /**
   * Nostr pubkey (32-byte hex) of the recipient when this amount-entry was
   * launched from a chat surface. UI-agnostic identity — consumers resolve to
   * a profile (picture, displayName) via their own metadata cache. Threaded
   * through `FlowContext` and surfaced on `navigateToMeltPreview` /
   * `navigateToPaymentRequest` / `sendComplete` step data.
   */
  recipientPubkey?: string;
  /**
   * Pre-resolved Nostr kind-0 profile for `recipientPubkey`. When the machine
   * has fetched it via `operations.resolveRecipientProfile`, consumer UIs can
   * render avatar + display name without re-fetching.
   */
  recipientProfile?: import('./machine/types').RecipientProfile;
  destination: 'paymentRequest' | 'meltQuote' | 'sendEcash' | 'mintQuote';
}

// ---------------------------------------------------------------------------
// Mint Selection
// ---------------------------------------------------------------------------

/**
 * Bulk catalog entry returned by `fetchMintCatalog`. One round-trip for every
 * trusted mint, awaited inside `buildMintListItems` and merged directly into
 * each `MintListItem` — no subscribe-and-pray, no fire-and-forget per-mint
 * fetches, no separate enrichment caches involved in the list flow.
 */
export interface MintCatalogEntry {
  /** KYM (Know Your Mint) community score on a 0-5 scale. */
  kymScore?: number;
  /** Number of community reviews behind `kymScore`. */
  reviewCount?: number;
  /** Auditor swap success score on a 0-5 scale. */
  auditScore?: number;
  /** Auditor state string, e.g. 'OK' or 'ERROR'. */
  auditState?: string;
  /** Total mint+melt operations the auditor has observed for this mint.
   *  Rendered as `(123)` next to the audit %. */
  auditTotalOps?: number;
  /** Follower count of the mint operator's Nostr identity. */
  contactFollowers?: number;
  /** Reputation score (0-100) of the mint operator's Nostr identity. */
  contactReputation?: number;
}

/**
 * A fully-resolved mint row ready for display. Built by the wallet before navigation so
 * the mint list screen requires no data fetching — all balances, scores, and availability
 * are pre-computed and passed as props.
 *
 * `status` / `reason` are derived from `MintAvailability` and encode whether the mint is
 * selectable in the current flow context (e.g. insufficient balance, not in payment request).
 *
 * Catalog fields (`kymScore`, `auditScore`, etc.) come from `fetchMintCatalog`
 * — see `MintCatalogEntry`. They're optional; the screen renders gracefully without them.
 */
export interface MintListItem {
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  balance: number;
  unit: string;
  /** Whether this mint can be selected in the current flow. */
  status: 'available' | 'disabled';
  /** Reason the mint is disabled, null when status is 'available'. */
  reason: import('./formatting/locales').LocalizedReason | null;
  isPreferred: boolean;
  /** KYM (Know Your Mint) community score, cached from Nostr events. */
  kymScore?: number;
  /** Number of community reviews behind `kymScore`. */
  reviewCount?: number;
  /** Auditor swap success score on a 0-5 scale. */
  auditScore?: number;
  /** Auditor state string, e.g. 'OK' or 'ERROR'. */
  auditState?: string;
  /** Total mint+melt operations the auditor has observed for this mint. */
  auditTotalOps?: number;
  /** Whether this mint can send the requested amount offline (exact proof composition). */
  worksOffline?: boolean;
  /** Whether the mint was unreachable during enrichment. */
  unreachable?: boolean;
  /** Follower count of the mint operator's Nostr identity (from NUT-06 contact info). */
  contactFollowers?: number;
  /** Reputation score (0-100) of the mint operator's Nostr identity. */
  contactReputation?: number;
}

/**
 * Detailed mint info for the trust review screen. Extends `MintListItem` fields
 * with NUT-06 metadata (description, contact, MOTD, supported NUTs) and trust status.
 *
 * Populated by `operations.buildMintReviewInfo()` when the machine enters
 * the `reviewMint` step. The handler receives this in `stepData.mintInfo`.
 */
export interface MintReviewInfo {
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  description?: string;
  longDescription?: string;
  motd?: string;
  contact?: { method: string; info: string }[];
  nuts?: number[];
  balance: number;
  unit: string;
  isPreferred: boolean;
  isTrusted: boolean;
  kymScore?: number;
  /** Number of community reviews behind `kymScore`. */
  reviewCount?: number;
  auditScore?: number;
  auditState?: string;
  successRate?: number;
  avgTimeMs?: number;
  swapSuccess?: number;
  swapTotal?: number;
  totalMints?: number;
  totalMelts?: number;
  /** Follower count of the mint operator's Nostr identity (NUT-06 contact). */
  contactFollowers?: number;
  /** Reputation score (0-100) of the mint operator's Nostr identity. */
  contactReputation?: number;
}

export type MintSelectionResult =
  | { type: 'selected'; mintUrl: string; balance: number }
  | { type: 'selectionNeeded'; validMints: MintCandidate[] }
  | { type: 'noValidMint'; reason: import('./formatting/locales').LocalizedReason };

export interface MintCandidate {
  mintUrl: string;
  balance: number;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export interface GuardResult {
  guard: string;
  passed: boolean;
  reason?: import('./formatting/locales').LocalizedReason;
}

// ---------------------------------------------------------------------------
// Wallet Capabilities — used for completeness checking.
// The wallet declares what it supports; the library checks whether all
// required capabilities for a given intent are covered.
// ---------------------------------------------------------------------------

export type WalletCapability =
  | 'amountEntry'
  | 'mintSelection'
  | 'optionSelection'
  | 'proofSelection'
  | 'meltQuoteFetch'
  | 'tokenReceive'
  | 'httpTransport'
  | 'mintInfo'
  | 'profileView';

export interface CapabilityCheckResult {
  covered: boolean;
  missing: WalletCapability[];
}

// ---------------------------------------------------------------------------
// Proof Composition — pure math primitives for subset-sum analysis.
// The wallet uses these to power its own proof selection UX.
// ---------------------------------------------------------------------------

export interface ExactOfflineAmountIndex {
  reachableSums: number[];
  totalReadyBalance: number;
}

export interface FiatMinorUnitSatRange {
  minSat: number;
  maxSat: number;
}

export interface CompositionResult {
  exactMatch: boolean;
  target: number;
  nearestLower: number | null;
  nearestUpper: number | null;
  strategy: 'exhaustive' | 'meet-in-the-middle' | 'bitset-dp';
  elapsedMs: number;
}

export interface FiatCompositionResult {
  requestedFiat: number;
  satoshiInterval: [number, number];
  exactFiatMatch: boolean;
  matchedSatoshis: number | null;
  nearestLowerFiat: { fiat: number; satoshis: number } | null;
  nearestUpperFiat: { fiat: number; satoshis: number } | null;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Recommendation Rules — used internally by annotate module
// ---------------------------------------------------------------------------

export type RecommendationRule = {
  applies: (option: PaymentOption, ctx: WalletContext, info?: PaymentRequestInfo | null) => boolean;
  status: OptionStatus;
  reason: (
    option: PaymentOption,
    ctx: WalletContext,
    info?: PaymentRequestInfo | null,
    locale?: string
  ) => import('./formatting/locales').LocalizedReason | null;
};
