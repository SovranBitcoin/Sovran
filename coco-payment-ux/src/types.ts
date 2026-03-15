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
  reason: string | null;
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
  | { type: 'ignore'; reason: string };

export interface AmountEntryConstraints {
  paymentRequest?: string;
  meltTarget?: string;
  destination: 'paymentRequest' | 'meltQuote' | 'sendEcash' | 'mintQuote';
}

// ---------------------------------------------------------------------------
// Mint Selection
// ---------------------------------------------------------------------------

/**
 * A fully-resolved mint row ready for display. Built by the wallet before navigation so
 * the mint list screen requires no data fetching — all balances, scores, and availability
 * are pre-computed and passed as props.
 *
 * `status` / `reason` are derived from `MintAvailability` and encode whether the mint is
 * selectable in the current flow context (e.g. insufficient balance, not in payment request).
 *
 * `kymScore` and `auditScore` / `auditState` are optional — populated from local caches when
 * available, omitted otherwise. The screen should render without them gracefully.
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
  reason:
    | 'NOT_IN_PAYMENT_REQUEST'
    | 'INSUFFICIENT_BALANCE'
    | 'NO_BALANCE'
    | 'UNSUPPORTED_FOR_FLOW'
    | null;
  isPreferred: boolean;
  /** KYM (Know Your Mint) community score, cached from Nostr events. */
  kymScore?: number;
  /** Auditor swap success score on a 0-5 scale. */
  auditScore?: number;
  /** Auditor state string, e.g. 'OK' or 'ERROR'. */
  auditState?: string;
  /** Whether this mint can send the requested amount offline (exact proof composition). */
  worksOffline?: boolean;
}

export type MintSelectionResult =
  | { type: 'selected'; mintUrl: string; balance: number }
  | { type: 'selectionNeeded'; validMints: MintCandidate[] }
  | { type: 'noValidMint'; reason: string };

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
  reason?: string;
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
    info?: PaymentRequestInfo | null
  ) => string | null;
};
