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
} as const;

/** The flat, persisted/merged form. coco-metadata-compatible. */
export type AnnotationRecord = Record<string, string>;

export type CounterpartyDirection = "sender" | "recipient";
export type ScanMethod = "qr" | "nfc" | "paste" | "deeplink" | "ble";
export type LockDirection = "incoming" | "outgoing";
export type DistributionSource = "copy" | "share" | "airdrop" | "displayed";
export type SwapRole = "mint" | "melt";

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

  return record;
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

function parseOptionKinds(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through — malformed persisted value is treated as absent
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
  const optionKinds = parseOptionKinds(record[ANNOTATION_KEYS.scanOptionKinds]);
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

  return annotation;
}
