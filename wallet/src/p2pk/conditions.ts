// ---------------------------------------------------------------------------
// What a token's spending conditions actually say.
//
// One model, read by the pending-send screen, the timeline and the cancel
// rule, so those three can never tell the user three different stories about
// the same token.
//
// Why this parses tags itself instead of calling cashu-ts'
// `verifyP2PKSpendingConditions`: that function answers "does this witness
// satisfy the conditions". An outgoing send has no witness yet, so it reports
// FAILED for a perfectly healthy locked token — and it reads `Date.now()`
// internally, which a pure, time-injected model must not do. The verify and
// sign helpers belong at the crypto boundary, where a real witness exists.
// ---------------------------------------------------------------------------

import { parseP2PKSecret } from "@cashu/cashu-ts";

import { logger } from "../logger";
import { p2pkXOnly } from "./secret";

/**
 * How far past a locktime we wait before offering a reclaim. The mint judges
 * `locktime` against ITS clock, so acting the instant ours passes invites a
 * rejection the user cannot act on.
 */
export const LOCK_CLOCK_SKEW_MS = 60_000;

// These name the parts of `SpendingConditions`; reach them as
// `SpendingConditions['kind']` etc. rather than importing a second vocabulary.
type LockKind = "unlocked" | "p2pk" | "htlc" | "unknown";

type LockPhase = "permanent" | "timed-active" | "timed-expired";

/** What THIS wallet cannot do with these proofs, whatever the mint allows. */
type ClaimLimit = "multisig" | "sig-all" | "htlc" | "unparseable";

interface LockParty {
  /** Keys as written in the secret. Never logged. */
  pubkeys: string[];
  /** `n_sigs` / `n_sigs_refund`; 1 when the tag is absent. */
  requiredSignatures: number;
  /**
   * How many of `pubkeys` we hold. `null` when the caller named none.
   *
   * NUT-28 (P2BK) blinds the receiver's key per proof, and recognising that
   * needs our private keys and an ECDH step — not something a display model
   * should do. An undetected P2BK proof therefore reads as "locked to someone
   * else", which is the safe direction to be wrong in.
   */
  ourKeys: number | null;
}

/**
 * Whether the sender can get these proofs back, and when.
 *
 * `unknown` is not a hedge: it is what we must say when the caller did not
 * tell us which keys this wallet holds, because both "you can" and "you
 * cannot" would be claims we have not checked.
 */
export type ReclaimVerdict =
  | { kind: "not-locked" }
  | { kind: "unknown" }
  | { kind: "never"; because: "no-refund-tag" | "not-our-key" | "cannot-sign" }
  | { kind: "at"; at: number; via: "refund" | "public" }
  | { kind: "now"; via: "refund" | "public" };

export interface SpendingConditions {
  kind: LockKind;
  /** `null` only when nothing is locked. */
  phase: LockPhase | null;
  /** ms epoch when the locktime passes; `null` when the lock is permanent. */
  unlockAt: number | null;
  main: LockParty | null;
  /** `null` means NO refund tag — after `unlockAt` anyone may spend. */
  refund: LockParty | null;
  sigFlag: "SIG_INPUTS" | "SIG_ALL" | null;
  /** The proofs do not all carry the same conditions. */
  mixed: boolean;
  proofCount: number;
  lockedProofCount: number;
  reclaim: ReclaimVerdict;
  limits: ClaimLimit[];
  /** Tag keys present that this model does not represent. */
  unknownTags: string[];
}

const KNOWN_TAGS = new Set([
  "sigflag",
  "pubkeys",
  "n_sigs",
  "locktime",
  "refund",
  "n_sigs_refund",
]);

type Tag = string[];

function tagValues(tags: Tag[], key: string): string[] | null {
  const tag = tags.find((t) => t[0] === key);
  return tag ? tag.slice(1) : null;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** One proof's conditions, before they are compared across a token. */
interface ProofLock {
  kind: LockKind;
  mainKeys: string[];
  requiredSignatures: number;
  /** `null` = no refund tag at all. */
  refundKeys: string[] | null;
  requiredRefundSignatures: number;
  locktimeSec: number | null;
  sigFlag: "SIG_INPUTS" | "SIG_ALL" | null;
  unknownTags: string[];
}

const UNLOCKED: ProofLock = {
  kind: "unlocked",
  mainKeys: [],
  requiredSignatures: 1,
  refundKeys: null,
  requiredRefundSignatures: 1,
  locktimeSec: null,
  sigFlag: null,
  unknownTags: [],
};

function readProofLock(secret: string): ProofLock {
  let parsed: ReturnType<typeof parseP2PKSecret>;
  try {
    parsed = parseP2PKSecret(secret);
  } catch {
    // A plain random secret is an ordinary bearer proof, not a malformed lock.
    return UNLOCKED;
  }

  const [rawKind, body] = parsed as [string, { data?: string; tags?: Tag[] }];
  const kind: LockKind =
    rawKind === "P2PK" ? "p2pk" : rawKind === "HTLC" ? "htlc" : "unknown";
  const tags: Tag[] = Array.isArray(body?.tags) ? body.tags : [];
  const data = typeof body?.data === "string" ? body.data : "";

  const extraMain = tagValues(tags, "pubkeys") ?? [];
  const refundKeys = tagValues(tags, "refund");
  const locktime = positiveInt(tagValues(tags, "locktime")?.[0]);
  const rawSigFlag = tagValues(tags, "sigflag")?.[0];

  return {
    kind,
    mainKeys: data ? [data, ...extraMain] : extraMain,
    requiredSignatures: positiveInt(tagValues(tags, "n_sigs")?.[0]) ?? 1,
    refundKeys,
    requiredRefundSignatures:
      positiveInt(tagValues(tags, "n_sigs_refund")?.[0]) ?? 1,
    locktimeSec: locktime,
    sigFlag:
      rawSigFlag === "SIG_ALL"
        ? "SIG_ALL"
        : rawSigFlag === "SIG_INPUTS"
          ? "SIG_INPUTS"
          : null,
    unknownTags: tags.map((t) => t[0]).filter((key) => !KNOWN_TAGS.has(key)),
  };
}

/** Stable identity of a condition set, for spotting a mixed token. */
function lockSignature(lock: ProofLock): string {
  return JSON.stringify([
    lock.kind,
    lock.mainKeys.map((k) => p2pkXOnly(k) ?? k),
    lock.requiredSignatures,
    lock.refundKeys?.map((k) => p2pkXOnly(k) ?? k) ?? null,
    lock.requiredRefundSignatures,
    lock.locktimeSec,
    lock.sigFlag,
  ]);
}

function countOurs(
  keys: string[],
  ours: readonly string[] | undefined,
): number | null {
  if (!ours) return null;
  const mine = new Set(
    ours.map((key) => p2pkXOnly(key)).filter((x): x is string => !!x),
  );
  const seen = new Set<string>();
  for (const key of keys) {
    const x = p2pkXOnly(key);
    if (x && mine.has(x)) seen.add(x);
  }
  return seen.size;
}

function verdict(
  lock: ProofLock,
  refund: LockParty,
  unlockAt: number | null,
  now: number,
  skewMs: number,
): ReclaimVerdict {
  // No refund tag: after the locktime the proof needs no signature at all, so
  // anyone holding the token can spend it — us included, but not only us.
  if (lock.refundKeys === null) {
    if (unlockAt === null) return { kind: "never", because: "no-refund-tag" };
    return now >= unlockAt + skewMs
      ? { kind: "now", via: "public" }
      : { kind: "at", at: unlockAt, via: "public" };
  }
  // A refund tag without a locktime can never be reached: NUT-11 only opens
  // the refund path once the locktime has passed, and an absent locktime is a
  // permanent lock.
  if (unlockAt === null) return { kind: "never", because: "no-refund-tag" };
  if (refund.ourKeys === null) return { kind: "unknown" };
  if (refund.ourKeys === 0) return { kind: "never", because: "not-our-key" };
  if (refund.ourKeys < refund.requiredSignatures) {
    return { kind: "never", because: "cannot-sign" };
  }
  return now >= unlockAt + skewMs
    ? { kind: "now", via: "refund" }
    : { kind: "at", at: unlockAt, via: "refund" };
}

const UNLOCKED_CONDITIONS: Omit<SpendingConditions, "proofCount"> = {
  kind: "unlocked",
  phase: null,
  unlockAt: null,
  main: null,
  refund: null,
  sigFlag: null,
  mixed: false,
  lockedProofCount: 0,
  reclaim: { kind: "not-locked" },
  limits: [],
  unknownTags: [],
};

/**
 * Describe a whole token's spending conditions.
 *
 * `now` is injected rather than read, so every surface that renders a lock —
 * and every test — agrees on when "expired" began.
 */
/** Assemble the public model from one condition set and its proof counts. */
function assemble(
  lock: ProofLock,
  counts: { proofCount: number; lockedProofCount: number; mixed: boolean },
  now: number,
  ourPubkeys: readonly string[] | undefined,
  skewMs: number,
): SpendingConditions {
  const main: LockParty = {
    pubkeys: lock.mainKeys,
    requiredSignatures: lock.requiredSignatures,
    ourKeys: countOurs(lock.mainKeys, ourPubkeys),
  };
  const refund: LockParty = {
    pubkeys: lock.refundKeys ?? [],
    requiredSignatures: lock.requiredRefundSignatures,
    ourKeys: lock.refundKeys ? countOurs(lock.refundKeys, ourPubkeys) : 0,
  };

  const unlockAt = lock.locktimeSec === null ? null : lock.locktimeSec * 1000;
  const phase: LockPhase =
    unlockAt === null
      ? "permanent"
      : now <= unlockAt
        ? "timed-active"
        : "timed-expired";

  const limits: ClaimLimit[] = [];
  if (lock.kind === "htlc") limits.push("htlc");
  if (lock.kind === "unknown") limits.push("unparseable");
  // Coco's claim path signs once, by exact key lookup, always SIG_INPUTS.
  if (lock.requiredSignatures > 1 || lock.requiredRefundSignatures > 1) {
    limits.push("multisig");
  }
  if (lock.sigFlag === "SIG_ALL") limits.push("sig-all");

  const conditions: SpendingConditions = {
    kind: lock.kind,
    phase,
    unlockAt,
    main,
    refund: lock.refundKeys === null ? null : refund,
    sigFlag: lock.sigFlag,
    mixed: counts.mixed,
    proofCount: counts.proofCount,
    lockedProofCount: counts.lockedProofCount,
    reclaim: verdict(lock, refund, unlockAt, now, skewMs),
    limits,
    unknownTags: lock.unknownTags,
  };

  logger.debug("p2pk.conditions.described", {
    kind: conditions.kind,
    phase: conditions.phase,
    hasRefundTag: conditions.refund !== null,
    mixed: conditions.mixed,
    proofCount: conditions.proofCount,
    lockedProofCount: conditions.lockedProofCount,
    reclaimKind: conditions.reclaim.kind,
    limits: conditions.limits,
  });

  return conditions;
}

/**
 * Describe a whole token's spending conditions.
 *
 * `now` is injected rather than read, so every surface that renders a lock —
 * and every test — agrees on when "expired" began.
 */
export function describeSpendingConditions(input: {
  proofs: readonly { secret: string }[];
  now: number;
  /** Public keys this wallet can sign for; omit when unknown. */
  ourPubkeys?: readonly string[];
  skewMs?: number;
}): SpendingConditions {
  const { proofs, now, ourPubkeys, skewMs = LOCK_CLOCK_SKEW_MS } = input;
  const locks = proofs.map((proof) => readProofLock(proof.secret));
  const locked = locks.filter((lock) => lock.kind !== "unlocked");

  if (locked.length === 0) {
    return { ...UNLOCKED_CONDITIONS, proofCount: proofs.length };
  }

  // The first locked condition set speaks for the token; `mixed` warns when
  // the rest disagree, because a partially-locked token is not safe to
  // summarise with one sentence.
  const signatures = new Set(locked.map(lockSignature));
  return assemble(
    locked[0]!,
    {
      proofCount: proofs.length,
      lockedProofCount: locked.length,
      mixed: signatures.size > 1 || locked.length !== proofs.length,
    },
    now,
    ourPubkeys,
    skewMs,
  );
}

/**
 * The same description, rebuilt from what we recorded when the token was
 * created — for after it has been handed over and its proofs are gone.
 *
 * `refundKeys: undefined` means the token carried no `refund` tag at all, which
 * is the difference between "you can take this back" and "anyone can".
 */
export function describeRecordedLock(input: {
  lock: {
    pubkey?: string;
    pubkeys?: string[];
    requiredSignatures?: number;
    locktime?: number;
    refundKeys?: string[];
    refundRequiredSignatures?: number;
    sigFlag?: "SIG_INPUTS" | "SIG_ALL";
  };
  now: number;
  ourPubkeys?: readonly string[];
  skewMs?: number;
}): SpendingConditions {
  const { lock, now, ourPubkeys, skewMs = LOCK_CLOCK_SKEW_MS } = input;
  const mainKeys = lock.pubkeys?.length
    ? lock.pubkeys
    : lock.pubkey
      ? [lock.pubkey]
      : [];
  return assemble(
    {
      kind: "p2pk",
      mainKeys,
      requiredSignatures: lock.requiredSignatures ?? 1,
      refundKeys: lock.refundKeys ?? null,
      requiredRefundSignatures: lock.refundRequiredSignatures ?? 1,
      locktimeSec: lock.locktime ?? null,
      sigFlag: lock.sigFlag ?? null,
      unknownTags: [],
    },
    // A record describes the lock we applied to the whole token, so there is
    // no proof-level disagreement to report.
    { proofCount: 0, lockedProofCount: 0, mixed: false },
    now,
    ourPubkeys,
    skewMs,
  );
}
