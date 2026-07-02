// ---------------------------------------------------------------------------
// Mesh transport — inbound token classification
//
// Port of sovran-app's nutDropTokens.ts: pure classification of a cashu
// token seen on the mesh against the active profile's P2PK lock key, plus
// the dedupe key the redeem queue is keyed by.
// ---------------------------------------------------------------------------

import {
  getDecodedToken,
  getP2PKExpectedWitnessPubkeys,
  parseP2PKSecret,
  type Secret,
} from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { amountToNumber } from "../amount";
import { logger, mintUrlFields } from "../logger";

/**
 * How an inbound mesh cashu token relates to the active profile:
 *
 * - `locked-to-me`     — every proof is P2PK-locked to my key → auto-redeem.
 * - `locked-to-other`  — P2PK-locked but not (entirely) to me → ignore
 *                        silently. Also covers the sender seeing its own
 *                        broadcast echo, multisig, and mixed tokens.
 * - `bearer`           — no P2PK locks at all (vanilla sender) → leave to
 *                        the manual tap-to-redeem affordance.
 * - `invalid`          — not a decodable cashu token.
 */
export type MeshTokenClass =
  | "locked-to-me"
  | "locked-to-other"
  | "bearer"
  | "invalid";

export interface ClassifiedMeshToken {
  classification: MeshTokenClass;
  mintUrl: string | null;
  /** Sum of proof amounts (mint units). */
  amount: number;
  unit: string | null;
}

/**
 * NUT-11 required-signature count from a parsed P2PK secret. cashu-ts 4.x
 * removed the getP2PKNSigs helper; the `n_sigs` tag defaults to 1 (single
 * sig) when absent or malformed.
 */
function getP2PKRequiredSigs(secret: Secret): number {
  const tags = secret[1]?.tags ?? [];
  const nSigs = tags.find((tag) => tag[0] === "n_sigs")?.[1];
  // Absent tag = single-sig per NUT-11. A PRESENT but unparseable/invalid
  // value must be treated as multisig ("never mine") — defaulting it to 1
  // would let an unspendable token classify as receivable.
  if (nSigs === undefined) return 1;
  const parsed = Number(nSigs);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Classify a cashu token against the active profile's P2PK lock key
 * (`myPubkey33` = "02" + x-only Nostr pubkey — the key the wallet's keyring
 * can sign for).
 *
 * `locked-to-me` requires EVERY proof to be single-sig locked to my key —
 * coco's receive path rejects multisig and would only partially own a mixed
 * token, so anything else is treated as locked-to-other.
 */
export function classifyMeshToken(
  tokenString: string,
  myPubkey33: string,
): ClassifiedMeshToken {
  const myKey = myPubkey33.toLowerCase();
  let mintUrl: string | null = null;
  let amount = 0;
  let unit: string | null = null;
  let lockedToMeCount = 0;
  let p2pkCount = 0;
  let otherConditionCount = 0;

  logger.debug("transport.classifyMeshToken.start", {
    tokenLength: tokenString.length,
    hasProfileKey: myKey.length > 0,
  });

  try {
    // No mint keysets available on the mesh path: pass an empty keyset list.
    // Standard (v0) keyset IDs decode fine; a short v2 keyset ID throws and
    // the token classifies as `invalid` — we can't verify locks we can't parse.
    const token = getDecodedToken(tokenString, []);
    mintUrl = token.mint ?? null;
    unit = token.unit ?? null;
    if (!Array.isArray(token.proofs) || token.proofs.length === 0) {
      const result = {
        classification: "invalid" as const,
        mintUrl,
        amount,
        unit,
      };
      logger.warn("transport.classifyMeshToken.invalidProofs", {
        ...mintUrlFields(mintUrl),
        unit,
        proofCount: Array.isArray(token.proofs) ? token.proofs.length : null,
      });
      return result;
    }

    for (const proof of token.proofs) {
      amount += amountToNumber(proof.amount);
      let secret: ReturnType<typeof parseP2PKSecret>;
      try {
        secret = parseP2PKSecret(proof.secret);
      } catch {
        if (isWellKnownConditionSecret(proof.secret)) {
          // A NUT-10 condition we can't satisfy (HTLC, future kinds, or
          // malformed P2PK). NOT a bearer proof — receiving it would
          // accept un-spendable funds.
          otherConditionCount += 1;
        }
        // Otherwise a plain random secret — a bearer proof.
        continue;
      }
      p2pkCount += 1;
      try {
        if (getP2PKRequiredSigs(secret) > 1) continue; // multisig — never "mine"
        const expected = getP2PKExpectedWitnessPubkeys(secret).map((k) =>
          k.toLowerCase(),
        );
        if (expected.length === 1 && expected[0] === myKey) {
          lockedToMeCount += 1;
        }
      } catch {
        // Malformed P2PK tags — count as locked-to-other (not redeemable).
      }
    }

    const classification: MeshTokenClass =
      p2pkCount === 0 && otherConditionCount === 0
        ? "bearer"
        : p2pkCount === token.proofs.length &&
            lockedToMeCount === token.proofs.length
          ? "locked-to-me"
          : "locked-to-other";
    const result: ClassifiedMeshToken = {
      classification,
      mintUrl,
      amount,
      unit,
    };
    logger.info("transport.classifyMeshToken.result", {
      classification,
      ...mintUrlFields(mintUrl),
      amount,
      unit,
      proofCount: token.proofs.length,
      p2pkCount,
      lockedToMeCount,
      otherConditionCount,
    });
    return result;
  } catch (err) {
    logger.warn("transport.classifyMeshToken.decodeFailed", {
      tokenLength: tokenString.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return { classification: "invalid", mintUrl, amount, unit };
  }
}

/**
 * NUT-10 well-known secrets are JSON arrays of the form `["KIND", {...}]`.
 * Anything matching that shape but failing the P2PK parser is a spending
 * condition this wallet cannot satisfy.
 */
function isWellKnownConditionSecret(secret: string): boolean {
  try {
    const parsed: unknown = JSON.parse(secret);
    return Array.isArray(parsed) && typeof parsed[0] === "string";
  } catch {
    return false;
  }
}

/**
 * Stable dedupe key for an encoded token. The same broadcast can arrive
 * multiple times via mesh relay/gossip sync, so the redeem queue is keyed by
 * this.
 */
export function meshTokenDedupeKey(tokenString: string): string {
  logger.debug("transport.meshTokenDedupeKey", {
    tokenLength: tokenString.length,
  });
  return bytesToHex(sha256(utf8ToBytes(tokenString)));
}
