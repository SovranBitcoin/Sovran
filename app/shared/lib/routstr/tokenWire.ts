import { Amount, getEncodedToken, getTokenMetadata, type Token } from '@cashu/cashu-ts';
import { base64url, utf8 } from '@scure/base';
import { z } from 'zod';

/**
 * How a payment token is spelled on the wire to a Routstr node.
 *
 * `@cashu/cashu-ts` v5 encodes every token as the compact V4 (`cashuB`) form,
 * and for a version-1 keyset — the 33-byte ids Minibits rotated onto in 2026
 * (`01fc0ec0…a821`) — V4 carries only the 8-byte SHORT id (`01fc0ec0e59cd6fa`),
 * as NUT-00 allows. Every node then has to expand the short id against the
 * mint's keyset list before it can do anything with the proof.
 *
 * routstr-core learned to do that on 2026-08-14 (`10a72ac1`, shipped in
 * v0.4.5). Every node older than that keys its wallet by the FULL id and does
 * not expand: with DLEQ on the proofs, nutshell's `verify_proofs_dleq` asserts
 * `Keyset 01fc0ec0e59cd6fa not known, can not verify DLEQ` (400); without DLEQ
 * the fee lookup `self.keysets[proof.id]` raises `KeyError`, unclassified, as
 * 500 "Internal error during token redemption". Both appear in `app/log.txt`
 * on 2026-09-26, against `node1.routstr.blazelight.dev` (0.4.3) and
 * `ai.orangesync.tech` (0.4.4) — the only two pre-0.4.5 nodes in the run, and
 * the only two payment-layer failures.
 *
 * The client's half of the contract is to send an id every node can look up,
 * and the V3 (`cashuA`, JSON) form carries the id whole: NUT-00's original
 * encoding, decoded by every nutshell release. So a token whose proofs carry a
 * version-1 keyset id goes out as V3, and everything else keeps the compact V4
 * the mint and the node both prefer. cashu-ts v5 no longer reads V3 at all,
 * which is why the decoder half lives here too: the sweep re-receives a
 * journalled token through the wallet, and the wallet only speaks V4.
 *
 * DLEQ proofs are dropped from the V3 form. A node verifies them only when
 * present, redeems by swapping at the mint either way, and returns its own
 * change without them — so they buy nothing on this path and cost a third of
 * the header.
 */

/** Hex length of a version-0 keyset id (8 bytes). Anything longer is v1. */
const V0_KEYSET_ID_HEX = 16;

const V3_PREFIX = 'cashuA';

const WireProofSchema = z.object({
  id: z.string().min(1).max(66),
  amount: z.number().int().nonnegative(),
  secret: z.string().min(1).max(1024),
  C: z.string().min(1).max(66),
});

const WireTokenSchema = z.object({
  token: z
    .array(
      z.object({
        mint: z.string().min(1).max(512),
        proofs: z.array(WireProofSchema).min(1).max(256),
      })
    )
    .min(1)
    .max(1),
  unit: z.string().max(16).optional(),
  memo: z.string().max(512).optional(),
});

type WireToken = z.infer<typeof WireTokenSchema>;

/** The distinct keyset ids a token's proofs come from. */
export function keysetIdsOf(token: Pick<Token, 'proofs'>): string[] {
  return [...new Set(token.proofs.map((proof) => proof.id))];
}

/** True when any proof carries a version-1 keyset id, which V4 would shorten. */
export function needsFullKeysetIds(token: Pick<Token, 'proofs'>): boolean {
  return token.proofs.some((proof) => proof.id.length > V0_KEYSET_ID_HEX);
}

/**
 * Encode a token for a Routstr node's `X-Cashu` header.
 *
 * Returns which spelling was used beside the string, so the send log can say
 * so — a V3 token on the wire is the one deliberate deviation from what the
 * wallet would produce, and a reader should not have to infer it.
 */
export function encodeTokenForNode(token: Token): { encoded: string; wire: 'v3' | 'v4' } {
  if (!needsFullKeysetIds(token)) return { encoded: getEncodedToken(token), wire: 'v4' };
  const body: WireToken = {
    token: [
      {
        mint: token.mint,
        proofs: token.proofs.map((proof) => ({
          id: proof.id,
          amount: Amount.from(proof.amount).toNumber(),
          secret: proof.secret,
          C: proof.C,
        })),
      },
    ],
    unit: token.unit ?? 'sat',
    ...(token.memo ? { memo: token.memo } : {}),
  };
  return {
    encoded: `${V3_PREFIX}${base64url.encode(utf8.decode(JSON.stringify(body)))}`,
    wire: 'v3',
  };
}

/** Decode a V3 token this module produced, or `null` for anything else. */
export function decodeWireToken(encoded: string): WireToken | null {
  if (!encoded.startsWith(V3_PREFIX)) return null;
  try {
    const raw = encoded.slice(V3_PREFIX.length);
    // Padding is optional on the wire (nutshell strips and re-adds it); the
    // decoder here is strict, so normalise before handing it over.
    const bare = raw.replace(/=+$/, '');
    const padded = bare + '='.repeat((4 - (bare.length % 4)) % 4);
    const parsed: unknown = JSON.parse(utf8.encode(base64url.decode(padded)));
    const result = WireTokenSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * The wallet's own spelling of a token that may be on-the-wire V3.
 *
 * A V4 string passes through untouched. A V3 string is rebuilt as a `Token`
 * and re-encoded, because `@cashu/cashu-ts` v5 — and therefore Coco — cannot
 * read V3, and the sweep has to be able to hand a journalled token back to the
 * wallet when the node says it never took it.
 */
export function toWalletToken(encoded: string): string {
  const wire = decodeWireToken(encoded);
  if (!wire) return encoded;
  const [entry] = wire.token;
  const token: Token = {
    mint: entry.mint,
    unit: wire.unit ?? 'sat',
    ...(wire.memo ? { memo: wire.memo } : {}),
    proofs: entry.proofs.map((proof) => ({
      id: proof.id,
      amount: Amount.from(proof.amount),
      secret: proof.secret,
      C: proof.C,
    })),
  };
  return getEncodedToken(token);
}

/**
 * The amount and unit of a token in either spelling.
 *
 * `null` when the string decodes as neither — used where a token is talked
 * ABOUT rather than moved, so a bad string is a missing figure, not a throw.
 */
export function wireTokenAmount(encoded: string): { amount: number; unit: string } | null {
  const wire = decodeWireToken(encoded);
  if (wire) {
    return {
      amount: wire.token[0].proofs.reduce((sum, proof) => sum + proof.amount, 0),
      unit: wire.unit ?? 'sat',
    };
  }
  try {
    const metadata = getTokenMetadata(encoded);
    return { amount: metadata.amount.toNumber(), unit: metadata.unit };
  } catch {
    return null;
  }
}
