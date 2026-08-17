// ---------------------------------------------------------------------------
// Transaction annotations — flat model (framework-agnostic)
// ---------------------------------------------------------------------------
//
// coco's history `metadata` is `Record<string, string>`, read-only, and only
// auto-populated for receive operations. Wallets still need to attach
// per-transaction side-data that coco never stores: who the counterparty was,
// how/what was scanned, whether a token was P2PK-locked, how an invoice was
// distributed, where the payment happened, and which swap group a leg belongs
// to.
//
// colada owns that side-data as "annotations". They persist as a flat
// `Record<string, string>` — deliberately the same shape as coco's `metadata`
// so an annotation merges straight into an entry's metadata at read time and
// could be upstreamed into coco verbatim if coco ever exposes a write API.
// Callers never touch the flat keys: they write/read the rich
// `TransactionAnnotation` shape and `encode`/`decode` bridge the two.

/** Canonical flat keys. The persisted unit is `Record<flatKey, string>`. */
export const ANNOTATION_KEYS = {
  counterpartyPubkey: "counterpartyPubkey",
  counterpartyDisplayName: "counterpartyDisplayName",
  counterpartyAvatarUrl: "counterpartyAvatarUrl",
  counterpartyNip05: "counterpartyNip05",
  counterpartyDirection: "counterpartyDirection",
  scanMethod: "scanMethod",
  scanRaw: "scanRaw",
  scanContainer: "scanContainer",
  scanOptionKinds: "scanOptionKinds",
  scanInputType: "scanInputType",
  lockType: "lockType",
  lockPubkey: "lockPubkey",
  lockDirection: "lockDirection",
  distributionSource: "distributionSource",
  geoLat: "geoLat",
  geoLng: "geoLng",
  swapGroupId: "swapGroupId",
  swapRole: "swapRole",
  swapChainId: "swapChainId",
  swapHopIndex: "swapHopIndex",
  creqP2pkLock: "creqP2pkLock",
  creqExcludedMints: "creqExcludedMints",
  paymentRequestRole: "paymentRequestRole",
  paymentRequestId: "paymentRequestId",
  paymentRequestTransport: "paymentRequestTransport",
  onchainOutpoint: "onchainOutpoint",
  onchainOutpointSource: "onchainOutpointSource",
  onchainFeeIndex: "onchainFeeIndex",
  onchainFeeReserveSats: "onchainFeeReserveSats",
  onchainEffectiveFeeSats: "onchainEffectiveFeeSats",
  onchainSettledOffchain: "onchainSettledOffchain",
  onchainAddress: "onchainAddress",
  onchainAmountSats: "onchainAmountSats",
  onchainAccelerated: "onchainAccelerated",
  zapEventId: "zapEventId",
  zapEventKind: "zapEventKind",
  zapAuthorPubkey: "zapAuthorPubkey",
  zapAuthorName: "zapAuthorName",
  zapAuthorAvatarUrl: "zapAuthorAvatarUrl",
  zapContentPreview: "zapContentPreview",
  zapEmoji: "zapEmoji",
  zapComment: "zapComment",
  zapReceiptKind: "zapReceiptKind",
} as const;

/** The flat, persisted/merged form. coco-metadata-compatible. */
export type AnnotationRecord = Record<string, string>;

export type CounterpartyDirection = "sender" | "recipient";
export type ScanMethod = "qr" | "nfc" | "paste" | "deeplink" | "ble";
export type LockDirection = "incoming" | "outgoing";
export type DistributionSource = "copy" | "share" | "airdrop" | "displayed";
export type SwapRole = "mint" | "melt";
/** Which side of a NUT-18 payment request this transaction was. */
export type PaymentRequestRole = "payer" | "payee";
/** How the token travelled (`http` = POST transport on the send side; coco's
 *  receive ingest reports `inband`/`post`). Distinct name from types.ts's
 *  `PaymentRequestTransport` (the decoded `{type, target}` transport entry). */
export type PaymentRequestAnnotationTransport =
  | "nostr"
  | "http"
  | "inband"
  | "post";
/** Who produced a persisted onchain-melt outpoint: the mint's quote row, or
 *  our own mempool.space destination-address match (best-effort). */
export type OnchainOutpointSource = "mint" | "heuristic";
/** How a post payment travelled: `nip57` = a signed kind-9734 zap request
 *  rode the LNURL callback (the recipient's server publishes the 9735
 *  receipt); `plain` = the target didn't advertise `allowsNostr`, so it was
 *  paid as a normal lightning send but is still recorded as a post payment. */
export type ZapReceiptKind = "nip57" | "plain";

/** The rich, decoded form callers read and write. Every field is optional. */
export interface TransactionAnnotation {
  counterparty?: {
    pubkey?: string;
    displayName?: string;
    avatarUrl?: string;
    nip05?: string;
    direction?: CounterpartyDirection;
  };
  scan?: {
    method?: ScanMethod;
    raw?: string;
    container?: string;
    optionKinds?: string[];
    inputType?: string;
  };
  lock?: {
    type?: "p2pk";
    pubkey?: string;
    direction?: LockDirection;
  };
  distribution?: {
    source?: DistributionSource;
  };
  location?: {
    lat: number;
    lng: number;
  };
  swap?: {
    groupId?: string;
    role?: SwapRole;
    chainId?: string;
    hopIndex?: number;
  };
  /**
   * Per-request Cashu-payment-request advertise conditions for a single-use
   * "Fixed Amount → as Ecash" request (keyed by `op:<operationId>`). Lets one
   * request carry its own P2PK-lock / advertised-mint choices, seeded from the
   * global `mintStore` default, without mutating that global. `excludedMints`
   * is the explicit exclusion list (empty array = advertise all).
   */
  creqCustomization?: {
    p2pkLock?: boolean;
    excludedMints?: string[];
  };
  /**
   * Marks a send/receive as having been settled via a NUT-18 Cashu payment
   * request, so the history detail can say "payment request" instead of
   * presenting it as plain bearer ecash. `role` is which side we were
   * (`payer` = we paid someone's creq, `payee` = a payment arrived on our
   * creq); `requestId` is the short NUT-18 `i` field for cross-referencing;
   * `transport` is how the token travelled. The creq string itself is
   * deliberately NOT persisted here (it's large and reconstructible facts
   * only belong in coco).
   */
  paymentRequest?: {
    role?: PaymentRequestRole;
    requestId?: string;
    transport?: PaymentRequestAnnotationTransport;
  };
  /**
   * Onchain melt (NUT-30 send) settlement facts, persisted so the detail
   * screen keeps its explorer link and fee line after the mint stops serving
   * the quote row (coco's MeltHistoryEntry never carries the outpoint).
   * `outpoint` is the spec `txid:vout`; `feeReserveSats` is the SELECTED
   * option's maximum fee; `effectiveFeeSats` is the actual settled cost when
   * coco reports one.
   *
   * `settledOffchain` persists the off-chain (internal) settlement verdict so
   * reopening a completed send never re-derives it from live polling. A
   * mint-provided `outpoint` always outranks it: readers must derive
   * `settledInternally = settledOffchain && !outpoint`, and a `heuristic`
   * `outpointSource` must be overwritten whenever the mint reports the real
   * outpoint. `address`/`amountSats` are the melt destination facts needed to
   * find the tx ourselves when the mint withholds the outpoint.
   */
  onchainMelt?: {
    outpoint?: string;
    outpointSource?: OnchainOutpointSource;
    feeIndex?: number;
    feeReserveSats?: number;
    effectiveFeeSats?: number;
    settledOffchain?: boolean;
    address?: string;
    amountSats?: number;
    /** The tx was boosted via the mempool.space Accelerator. */
    accelerated?: boolean;
  };
  /**
   * Marks a melt as a payment for a nostr post (a "zap"), so the history
   * detail can render the zapped post and link back to its thread. Only
   * small reconstructible facts are persisted — the post `eventId` plus a
   * short display snapshot (author, ~120-char content preview, the preset
   * emoji and comment). The raw nostr event is deliberately NOT stored.
   */
  zap?: {
    /** Zapped post's nostr event id (hex). */
    eventId?: string;
    /** Zapped post's kind (the 9734 `k` tag). */
    eventKind?: number;
    /** Post author's nostr pubkey (hex). */
    authorPubkey?: string;
    authorName?: string;
    authorAvatarUrl?: string;
    /** First ~120 chars of the post content, newlines collapsed. */
    contentPreview?: string;
    /** Preset emoji chosen in the zap menu. */
    emoji?: string;
    /** Zap comment (9734 content / canned preset message). */
    comment?: string;
    receiptKind?: ZapReceiptKind;
  };
}

function setString(
  record: AnnotationRecord,
  key: string,
  value: string | undefined | null,
): void {
  if (typeof value === "string" && value.length > 0) record[key] = value;
}

/**
 * Flatten a rich annotation patch into the persisted `Record<string, string>`.
 * Only defined, non-empty fields are written, so patches are additive and a
 * later `set` never clears earlier keys it doesn't mention.
 */
export function encodeAnnotation(
  patch: TransactionAnnotation,
): AnnotationRecord {
  const record: AnnotationRecord = {};

  if (patch.counterparty) {
    setString(
      record,
      ANNOTATION_KEYS.counterpartyPubkey,
      patch.counterparty.pubkey,
    );
    setString(
      record,
      ANNOTATION_KEYS.counterpartyDisplayName,
      patch.counterparty.displayName,
    );
    setString(
      record,
      ANNOTATION_KEYS.counterpartyAvatarUrl,
      patch.counterparty.avatarUrl,
    );
    setString(
      record,
      ANNOTATION_KEYS.counterpartyNip05,
      patch.counterparty.nip05,
    );
    setString(
      record,
      ANNOTATION_KEYS.counterpartyDirection,
      patch.counterparty.direction,
    );
  }

  if (patch.scan) {
    setString(record, ANNOTATION_KEYS.scanMethod, patch.scan.method);
    setString(record, ANNOTATION_KEYS.scanRaw, patch.scan.raw);
    setString(record, ANNOTATION_KEYS.scanContainer, patch.scan.container);
    if (patch.scan.optionKinds && patch.scan.optionKinds.length > 0) {
      record[ANNOTATION_KEYS.scanOptionKinds] = JSON.stringify(
        patch.scan.optionKinds,
      );
    }
    setString(record, ANNOTATION_KEYS.scanInputType, patch.scan.inputType);
  }

  if (patch.lock) {
    setString(record, ANNOTATION_KEYS.lockType, patch.lock.type);
    setString(record, ANNOTATION_KEYS.lockPubkey, patch.lock.pubkey);
    setString(record, ANNOTATION_KEYS.lockDirection, patch.lock.direction);
  }

  if (patch.distribution) {
    setString(
      record,
      ANNOTATION_KEYS.distributionSource,
      patch.distribution.source,
    );
  }

  if (
    patch.location &&
    Number.isFinite(patch.location.lat) &&
    Number.isFinite(patch.location.lng)
  ) {
    record[ANNOTATION_KEYS.geoLat] = String(patch.location.lat);
    record[ANNOTATION_KEYS.geoLng] = String(patch.location.lng);
  }

  if (patch.swap) {
    setString(record, ANNOTATION_KEYS.swapGroupId, patch.swap.groupId);
    setString(record, ANNOTATION_KEYS.swapRole, patch.swap.role);
    setString(record, ANNOTATION_KEYS.swapChainId, patch.swap.chainId);
    if (
      typeof patch.swap.hopIndex === "number" &&
      Number.isFinite(patch.swap.hopIndex)
    ) {
      record[ANNOTATION_KEYS.swapHopIndex] = String(patch.swap.hopIndex);
    }
  }

  if (patch.creqCustomization) {
    // Persist booleans/empty-arrays explicitly (not via setString) so a
    // per-request `false` / "advertise all" overrides the global default
    // instead of falling back to it.
    if (typeof patch.creqCustomization.p2pkLock === "boolean") {
      record[ANNOTATION_KEYS.creqP2pkLock] = patch.creqCustomization.p2pkLock
        ? "1"
        : "0";
    }
    if (Array.isArray(patch.creqCustomization.excludedMints)) {
      record[ANNOTATION_KEYS.creqExcludedMints] = JSON.stringify(
        patch.creqCustomization.excludedMints,
      );
    }
  }

  if (patch.paymentRequest) {
    setString(record, ANNOTATION_KEYS.paymentRequestRole, patch.paymentRequest.role);
    setString(record, ANNOTATION_KEYS.paymentRequestId, patch.paymentRequest.requestId);
    setString(
      record,
      ANNOTATION_KEYS.paymentRequestTransport,
      patch.paymentRequest.transport,
    );
  }

  if (patch.onchainMelt) {
    setString(record, ANNOTATION_KEYS.onchainOutpoint, patch.onchainMelt.outpoint);
    setString(
      record,
      ANNOTATION_KEYS.onchainOutpointSource,
      patch.onchainMelt.outpointSource,
    );
    setFiniteNumber(record, ANNOTATION_KEYS.onchainFeeIndex, patch.onchainMelt.feeIndex);
    setFiniteNumber(
      record,
      ANNOTATION_KEYS.onchainFeeReserveSats,
      patch.onchainMelt.feeReserveSats,
    );
    setFiniteNumber(
      record,
      ANNOTATION_KEYS.onchainEffectiveFeeSats,
      patch.onchainMelt.effectiveFeeSats,
    );
    // The verdict only ever flips one way (settled off-chain); absence means
    // "unknown / on-chain", so only `true` is written.
    if (patch.onchainMelt.settledOffchain === true) {
      record[ANNOTATION_KEYS.onchainSettledOffchain] = "1";
    }
    setString(record, ANNOTATION_KEYS.onchainAddress, patch.onchainMelt.address);
    setFiniteNumber(
      record,
      ANNOTATION_KEYS.onchainAmountSats,
      patch.onchainMelt.amountSats,
    );
    if (patch.onchainMelt.accelerated === true) {
      record[ANNOTATION_KEYS.onchainAccelerated] = "1";
    }
  }

  if (patch.zap) {
    setString(record, ANNOTATION_KEYS.zapEventId, patch.zap.eventId);
    setFiniteNumber(record, ANNOTATION_KEYS.zapEventKind, patch.zap.eventKind);
    setString(record, ANNOTATION_KEYS.zapAuthorPubkey, patch.zap.authorPubkey);
    setString(record, ANNOTATION_KEYS.zapAuthorName, patch.zap.authorName);
    setString(
      record,
      ANNOTATION_KEYS.zapAuthorAvatarUrl,
      patch.zap.authorAvatarUrl,
    );
    setString(
      record,
      ANNOTATION_KEYS.zapContentPreview,
      patch.zap.contentPreview,
    );
    setString(record, ANNOTATION_KEYS.zapEmoji, patch.zap.emoji);
    setString(record, ANNOTATION_KEYS.zapComment, patch.zap.comment);
    setString(record, ANNOTATION_KEYS.zapReceiptKind, patch.zap.receiptKind);
  }

  return record;
}

function setFiniteNumber(
  record: AnnotationRecord,
  key: string,
  value: number | undefined | null,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    record[key] = String(value);
  }
}

function parseStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
  } catch {
    // malformed persisted value → treat as absent
  }
  return undefined;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Decode a flat record into the rich shape. A sub-object is only present when at
 * least one of its fields decoded, so callers can null-check `annotation.scan`
 * etc. directly.
 */
export function decodeAnnotation(
  record: AnnotationRecord,
): TransactionAnnotation {
  const annotation: TransactionAnnotation = {};

  const pubkey = record[ANNOTATION_KEYS.counterpartyPubkey];
  const displayName = record[ANNOTATION_KEYS.counterpartyDisplayName];
  const avatarUrl = record[ANNOTATION_KEYS.counterpartyAvatarUrl];
  const nip05 = record[ANNOTATION_KEYS.counterpartyNip05];
  const cpDirection = record[ANNOTATION_KEYS.counterpartyDirection];
  if (pubkey || displayName || avatarUrl || nip05 || cpDirection) {
    annotation.counterparty = {
      ...(pubkey ? { pubkey } : {}),
      ...(displayName ? { displayName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(nip05 ? { nip05 } : {}),
      ...(cpDirection
        ? { direction: cpDirection as CounterpartyDirection }
        : {}),
    };
  }

  const scanMethod = record[ANNOTATION_KEYS.scanMethod];
  const scanRaw = record[ANNOTATION_KEYS.scanRaw];
  const scanContainer = record[ANNOTATION_KEYS.scanContainer];
  const optionKinds = parseStringArray(record[ANNOTATION_KEYS.scanOptionKinds]);
  const scanInputType = record[ANNOTATION_KEYS.scanInputType];
  if (scanMethod || scanRaw || scanContainer || optionKinds || scanInputType) {
    annotation.scan = {
      ...(scanMethod ? { method: scanMethod as ScanMethod } : {}),
      ...(scanRaw ? { raw: scanRaw } : {}),
      ...(scanContainer ? { container: scanContainer } : {}),
      ...(optionKinds ? { optionKinds } : {}),
      ...(scanInputType ? { inputType: scanInputType } : {}),
    };
  }

  const lockType = record[ANNOTATION_KEYS.lockType];
  const lockPubkey = record[ANNOTATION_KEYS.lockPubkey];
  const lockDirection = record[ANNOTATION_KEYS.lockDirection];
  if (lockType || lockPubkey || lockDirection) {
    annotation.lock = {
      ...(lockType === "p2pk" ? { type: "p2pk" as const } : {}),
      ...(lockPubkey ? { pubkey: lockPubkey } : {}),
      ...(lockDirection ? { direction: lockDirection as LockDirection } : {}),
    };
  }

  const distributionSource = record[ANNOTATION_KEYS.distributionSource];
  if (distributionSource) {
    annotation.distribution = {
      source: distributionSource as DistributionSource,
    };
  }

  const lat = parseFiniteNumber(record[ANNOTATION_KEYS.geoLat]);
  const lng = parseFiniteNumber(record[ANNOTATION_KEYS.geoLng]);
  if (lat != null && lng != null) {
    annotation.location = { lat, lng };
  }

  const swapGroupId = record[ANNOTATION_KEYS.swapGroupId];
  const swapRole = record[ANNOTATION_KEYS.swapRole];
  const swapChainId = record[ANNOTATION_KEYS.swapChainId];
  const swapHopIndex = parseFiniteNumber(record[ANNOTATION_KEYS.swapHopIndex]);
  if (swapGroupId || swapRole || swapChainId || swapHopIndex != null) {
    annotation.swap = {
      ...(swapGroupId ? { groupId: swapGroupId } : {}),
      ...(swapRole ? { role: swapRole as SwapRole } : {}),
      ...(swapChainId ? { chainId: swapChainId } : {}),
      ...(swapHopIndex != null ? { hopIndex: swapHopIndex } : {}),
    };
  }

  const creqP2pkLockRaw = record[ANNOTATION_KEYS.creqP2pkLock];
  const creqExcludedMints = parseStringArray(
    record[ANNOTATION_KEYS.creqExcludedMints],
  );
  if (creqP2pkLockRaw != null || creqExcludedMints != null) {
    annotation.creqCustomization = {
      ...(creqP2pkLockRaw != null ? { p2pkLock: creqP2pkLockRaw === "1" } : {}),
      ...(creqExcludedMints != null ? { excludedMints: creqExcludedMints } : {}),
    };
  }

  const prRoleRaw = record[ANNOTATION_KEYS.paymentRequestRole];
  const prRole =
    prRoleRaw === "payer" || prRoleRaw === "payee"
      ? (prRoleRaw as PaymentRequestRole)
      : undefined;
  const prRequestId = record[ANNOTATION_KEYS.paymentRequestId];
  const prTransportRaw = record[ANNOTATION_KEYS.paymentRequestTransport];
  const prTransport =
    prTransportRaw === "nostr" ||
    prTransportRaw === "http" ||
    prTransportRaw === "inband" ||
    prTransportRaw === "post"
      ? (prTransportRaw as PaymentRequestAnnotationTransport)
      : undefined;
  if (prRole || prRequestId || prTransport) {
    annotation.paymentRequest = {
      ...(prRole ? { role: prRole } : {}),
      ...(prRequestId ? { requestId: prRequestId } : {}),
      ...(prTransport ? { transport: prTransport } : {}),
    };
  }

  const onchainOutpoint = record[ANNOTATION_KEYS.onchainOutpoint];
  const onchainOutpointSourceRaw = record[ANNOTATION_KEYS.onchainOutpointSource];
  const onchainOutpointSource =
    onchainOutpointSourceRaw === "mint" || onchainOutpointSourceRaw === "heuristic"
      ? (onchainOutpointSourceRaw as OnchainOutpointSource)
      : undefined;
  const onchainFeeIndex = parseFiniteNumber(record[ANNOTATION_KEYS.onchainFeeIndex]);
  const onchainFeeReserveSats = parseFiniteNumber(
    record[ANNOTATION_KEYS.onchainFeeReserveSats],
  );
  const onchainEffectiveFeeSats = parseFiniteNumber(
    record[ANNOTATION_KEYS.onchainEffectiveFeeSats],
  );
  const onchainSettledOffchain =
    record[ANNOTATION_KEYS.onchainSettledOffchain] === "1";
  const onchainAddress = record[ANNOTATION_KEYS.onchainAddress];
  const onchainAmountSats = parseFiniteNumber(
    record[ANNOTATION_KEYS.onchainAmountSats],
  );
  const onchainAccelerated = record[ANNOTATION_KEYS.onchainAccelerated] === "1";
  if (
    onchainOutpoint ||
    onchainOutpointSource ||
    onchainFeeIndex != null ||
    onchainFeeReserveSats != null ||
    onchainEffectiveFeeSats != null ||
    onchainSettledOffchain ||
    onchainAddress ||
    onchainAmountSats != null ||
    onchainAccelerated
  ) {
    annotation.onchainMelt = {
      ...(onchainOutpoint ? { outpoint: onchainOutpoint } : {}),
      ...(onchainOutpointSource ? { outpointSource: onchainOutpointSource } : {}),
      ...(onchainFeeIndex != null ? { feeIndex: onchainFeeIndex } : {}),
      ...(onchainFeeReserveSats != null ? { feeReserveSats: onchainFeeReserveSats } : {}),
      ...(onchainEffectiveFeeSats != null
        ? { effectiveFeeSats: onchainEffectiveFeeSats }
        : {}),
      ...(onchainSettledOffchain ? { settledOffchain: true } : {}),
      ...(onchainAddress ? { address: onchainAddress } : {}),
      ...(onchainAmountSats != null ? { amountSats: onchainAmountSats } : {}),
      ...(onchainAccelerated ? { accelerated: true } : {}),
    };
  }

  const zapEventId = record[ANNOTATION_KEYS.zapEventId];
  const zapEventKind = parseFiniteNumber(record[ANNOTATION_KEYS.zapEventKind]);
  const zapAuthorPubkey = record[ANNOTATION_KEYS.zapAuthorPubkey];
  const zapAuthorName = record[ANNOTATION_KEYS.zapAuthorName];
  const zapAuthorAvatarUrl = record[ANNOTATION_KEYS.zapAuthorAvatarUrl];
  const zapContentPreview = record[ANNOTATION_KEYS.zapContentPreview];
  const zapEmoji = record[ANNOTATION_KEYS.zapEmoji];
  const zapComment = record[ANNOTATION_KEYS.zapComment];
  const zapReceiptKindRaw = record[ANNOTATION_KEYS.zapReceiptKind];
  const zapReceiptKind =
    zapReceiptKindRaw === "nip57" || zapReceiptKindRaw === "plain"
      ? (zapReceiptKindRaw as ZapReceiptKind)
      : undefined;
  if (
    zapEventId ||
    zapEventKind != null ||
    zapAuthorPubkey ||
    zapAuthorName ||
    zapAuthorAvatarUrl ||
    zapContentPreview ||
    zapEmoji ||
    zapComment ||
    zapReceiptKind
  ) {
    annotation.zap = {
      ...(zapEventId ? { eventId: zapEventId } : {}),
      ...(zapEventKind != null ? { eventKind: zapEventKind } : {}),
      ...(zapAuthorPubkey ? { authorPubkey: zapAuthorPubkey } : {}),
      ...(zapAuthorName ? { authorName: zapAuthorName } : {}),
      ...(zapAuthorAvatarUrl ? { authorAvatarUrl: zapAuthorAvatarUrl } : {}),
      ...(zapContentPreview ? { contentPreview: zapContentPreview } : {}),
      ...(zapEmoji ? { emoji: zapEmoji } : {}),
      ...(zapComment ? { comment: zapComment } : {}),
      ...(zapReceiptKind ? { receiptKind: zapReceiptKind } : {}),
    };
  }

  return annotation;
}
