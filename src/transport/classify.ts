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
  getP2PKNSigs,
  parseP2PKSecret,
} from '@cashu/cashu-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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
export type MeshTokenClass = 'locked-to-me' | 'locked-to-other' | 'bearer' | 'invalid';

export interface ClassifiedMeshToken {
  classification: MeshTokenClass;
  mintUrl: string | null;
  /** Sum of proof amounts (mint units). */
  amount: number;
  unit: string | null;
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
export function classifyMeshToken(tokenString: string, myPubkey33: string): ClassifiedMeshToken {
  const myKey = myPubkey33.toLowerCase();
  let mintUrl: string | null = null;
  let amount = 0;
  let unit: string | null = null;
  let lockedToMeCount = 0;
  let p2pkCount = 0;
  let otherConditionCount = 0;

  try {
    const token = getDecodedToken(tokenString);
    mintUrl = token.mint ?? null;
    unit = token.unit ?? null;
    if (!Array.isArray(token.proofs) || token.proofs.length === 0) {
      return { classification: 'invalid', mintUrl, amount, unit };
    }

    for (const proof of token.proofs) {
      amount += proof.amount;
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
        if (getP2PKNSigs(secret) > 1) continue; // multisig — never "mine"
        const expected = getP2PKExpectedWitnessPubkeys(secret).map((k) => k.toLowerCase());
        if (expected.length === 1 && expected[0] === myKey) {
          lockedToMeCount += 1;
        }
      } catch {
        // Malformed P2PK tags — count as locked-to-other (not redeemable).
      }
    }

    if (p2pkCount === 0 && otherConditionCount === 0) {
      return { classification: 'bearer', mintUrl, amount, unit };
    }
    if (p2pkCount === token.proofs.length && lockedToMeCount === token.proofs.length) {
      return { classification: 'locked-to-me', mintUrl, amount, unit };
    }
    return { classification: 'locked-to-other', mintUrl, amount, unit };
  } catch {
    return { classification: 'invalid', mintUrl, amount, unit };
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
    return Array.isArray(parsed) && typeof parsed[0] === 'string';
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
  return bytesToHex(sha256(utf8ToBytes(tokenString)));
}
