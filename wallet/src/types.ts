import type { RequestControls } from './safeFetch';

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
  /**
   * The 33-byte `02`-prefixed P2PK lock key from the request's `nut10` option,
   * when it locks to a key. Null when the request carries no P2PK lock.
   */
  lockP2pkPubkey?: string | null;
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
   * Per-mint NUT-04/NUT-05 payment-method support derived from NUT-06 info.
   *
   * NUT-04 ("mint") gates receive quote creation. NUT-05 ("melt") gates
   * outbound payments. Missing method-unit metadata is treated as unavailable;
   * mints must advertise the method/unit pair they support.
   */
  mintMethodCapabilities?: MintMethodCapabilityMap;
  /**
   * Per-mint proof amounts. Keys are mint URLs, values are arrays of
   * individual proof denominations. Routing uses this to detect whether
   * a send amount is constructible without a swap and emit a
   * `selectProofs` step when it isn't.
   */
  proofAmounts: Record<string, number[]>;
}

export type MintPaymentMethod = 'bolt11' | 'bolt12' | 'onchain';
export type MintPaymentOperation = 'mint' | 'melt';

export interface MintMethodRequirement {
  operation: MintPaymentOperation;
  method: MintPaymentMethod;
  unit?: string;
}

export interface MintMethodUnitCapability {
  supported: boolean;
  disabled: boolean;
  method: MintPaymentMethod;
  unit: string;
  reason?: string;
  /**
   * NUT-04/05 advertised amount bounds for this method-unit pair, in the
   * capability's unit. Absent when the mint does not publish a bound on
   * that side (no constraint).
   */
  minAmount?: number;
  maxAmount?: number;
}

export type MintMethodSupport = Record<
  MintPaymentOperation,
  Partial<Record<MintPaymentMethod, MintMethodUnitCapability>>
> & {
  /**
   * NUT-17 websocket support, derived from the same cached mintInfo as the
   * method capabilities. Tri-state: `undefined` when the mint's info hasn't
   * been fetched yet (unknown — don't disable on it), boolean once known.
   * The NPC receive mint requires it (the npub.cash plugin subscribes to
   * quote settlement over the mint's websocket).
   */
  nut17?: boolean;
};

export type MintMethodCapabilityMap = Record<string, MintMethodSupport>;

export interface AmountEntryMethodContext {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
  preferredMintUrl?: string;
  mintMethodCapabilities?: MintMethodCapabilityMap;
}

// ---------------------------------------------------------------------------
// Parsed Payment Input
// ---------------------------------------------------------------------------

export type PaymentOptionKind =
  | 'ecashToken'
  | 'paymentRequest'
  | 'lightningInvoice'
  | 'lightningAddress'
  | 'lnurlp'
  | 'onchainAddress';

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
  unsupportedRequiredParamKeys: string[];
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
  | { type: 'meltOnchainAddress'; option: PaymentOption }
  | { type: 'openMint'; url: string }
  | { type: 'openProfile'; npub: string }
  | { type: 'chooseOption'; options: AnnotatedOption[] }
  | { type: 'ignore'; reason: import('./formatting/locales').LocalizedReason };

// ---------------------------------------------------------------------------
// Destination Descriptor — render-ready model for a Send-flow destination.
//
// `describeDestination` composes `resolveIntent` and decorates it with
// colada-owned copy, a semantic icon token, a statically-known amount, an
// action tag, and (for payable identities) a recipient slot the app fills in
// asynchronously. It is transient UI state — never persisted — so it is not
// subject to the persisted-enum migration invariant.
// ---------------------------------------------------------------------------

export type DestinationKind =
  | 'ecash' // cashu bearer token (redeem)
  | 'paymentRequest' // NUT-18 creq
  | 'lightningInvoice' // bolt11
  | 'lightningAddress' // lnurlp endpoint paid via Lightning (NOT an identity)
  | 'onchain' // bitcoin address
  | 'person' // payable Nostr identity (npub / nprofile / lightning address)
  | 'mint' // mint URL
  | 'unsupported'; // empty / unknown / UR fragment / parse errors

export type DestinationIcon =
  | 'ecash'
  | 'paymentRequest'
  | 'lightning'
  | 'onchain'
  | 'person'
  | 'mint'
  | 'unknown';

export type DestinationAction =
  | 'receiveToken' // redeem a bearer ecash token
  | 'sendPaymentRequest' // fulfill a creq
  | 'meltInvoice' // pay a bolt11
  | 'meltLnurl' // pay an lnurlp endpoint
  | 'meltOnchain' // pay a btc address
  | 'startContactSend' // person: app resolves profile, then contact send
  | 'chooseOption' // multi-option: defer to the existing chooser
  | 'openMint' // open mint info
  | 'none'; // unsupported / empty

export interface DestinationAmount {
  /** Integer amount in `unit`'s base unit (sats for `'sat'`). */
  value: number;
  unit: string;
}

export type DestinationRecipientRef =
  | { type: 'npub'; value: string } // bech32 npub
  | { type: 'lightningAddress'; value: string } // user@domain (LUD-16)
  | { type: 'pubkey'; value: string }; // 33-byte 02-prefixed P2PK lock from a creq

export interface DestinationRecipient {
  ref: DestinationRecipientRef;
  /** True until the app resolves a display name / avatar for `ref`. */
  pending: boolean;
}

export interface DestinationDescriptor {
  kind: DestinationKind;
  /**
   * Resolved, colada-owned copy for the *action portion* of the row, e.g.
   * "Redeem 100 sats", "Pay 100 sats", "Send onchain". For person-kinds this
   * is the bare verb ("Pay") and the app appends the resolved recipient name
   * it owns. Empty string for empty input (so the app can hide the row).
   */
  label: string;
  /**
   * Statically-known amount (token amount, invoice amount, fixed creq amount,
   * BIP-321 amount). Null when the user must enter it (lightning address,
   * amountless invoice, amountless creq, npub).
   */
  amount: DestinationAmount | null;
  icon: DestinationIcon;
  action: DestinationAction;
  /** Present only for person-kinds; the async name/avatar slot the app fills. */
  recipient?: DestinationRecipient;
  /**
   * True when the input carried more than one payable option (e.g. a BIP-321
   * URI). The row shows the primary option; tapping defers to the existing
   * chooser via `machine.execute(raw)`.
   */
  hasAlternatives: boolean;
  /** The exact string the app feeds back into routing (`machine.execute`) on tap. */
  raw: string;
}

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
  methodContext?: AmountEntryMethodContext;
  // 'receivePaymentRequest' = receive "as Ecash": a single-use NUT-18 request.
  // It shares the mintQuote amount screen (same "receive a fixed amount" intent)
  // but resolves to its own machine lane (createPaymentRequestReceive →
  // paymentRequestReceived) so delivery rides a machine step handler, not a
  // side-channel navigation callback.
  destination:
    | 'paymentRequest'
    | 'meltQuote'
    | 'sendEcash'
    | 'mintQuote'
    | 'receivePaymentRequest';
  /**
   * How the flow was entered (Create Ecash / scan / paste / contact) — lets
   * the amount screen render entry-appropriate chrome, e.g. a single
   * "Create ecash" action when the user explicitly chose that method.
   */
  entrySource?: import('./machine/types').SendEntrySource;
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

export interface MintContactProfile {
  pubkey: string;
  npub?: string;
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
  followers?: number;
  follows?: number;
  score?: number | null;
}

export interface MintReviewRecommendation {
  /**
   * The reviewer's [n/5] score, or null for a NIP-87 recommendation posted
   * without one (a score-less endorsement). Mirrors nagg's server-side parse —
   * colada no longer re-parses or drops these, so the recommendation list stays
   * 1:1 with the server's reviewCount.
   */
  score: number | null;
  comment: string;
  pubkey: string;
  eventId: string;
  created_at: number;
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
}

export interface MintReviewsSummary {
  mintUrl?: string;
  score: number | null;
  /**
   * Server's authoritative total review count (over the full review set, not
   * just the returned page). Consumers should prefer this over
   * `recommendations.length`, which is capped by the page limit.
   */
  reviewCount?: number;
  recommendations: MintReviewRecommendation[];
  lastUpdated?: number | null;
  fromCache?: boolean;
}

export type MintContactProfileResolver = (
  pubkey: string,
  mintUrl: string,
  controls?: RequestControls
) => Promise<MintContactProfile | undefined>;

export type MintReviewsFetcher = (
  mintUrl: string,
  controls?: RequestControls
) => Promise<MintReviewsSummary | undefined>;

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
  /** Unit the flow (and `balance`) is denominated in — NOT the mint's full unit set. */
  unit: string;
  /**
   * Units the mint can actually issue: advertised NUT-04 units gated on the
   * mint's real keysets. Absent on synchronous fallback rows (unknown) —
   * consumers treat absent as unrestricted.
   */
  supportedUnits?: string[];
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
  /** Resolved Nostr profile for the mint operator contact in NUT-06 metadata. */
  contactProfile?: MintContactProfile;
  /** Aggregated Nostr mint reviews for this mint. */
  reviews?: MintReviewsSummary;
}

export type MintSelectionResult =
  | { type: 'selected'; mintUrl: string; balance: number }
  | { type: 'selectionNeeded'; validMints: MintCandidate[] }
  | { type: 'noValidMint'; reason: import('./formatting/locales').LocalizedReason };

export interface MintCandidate {
  mintUrl: string;
  balance: number;
  status?: 'available' | 'disabled';
  reason?: import('./formatting/locales').LocalizedReason | null;
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
