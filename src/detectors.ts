// ---------------------------------------------------------------------------
// Default Detectors
//
// Built-in implementation using @cashu/cashu-ts, @gandlaf21/bolt11-decode,
// and nostr-tools. Wallets can use these out of the box or provide custom
// detectors via the Detectors interface.
//
// Detectors receive pre-normalized input from parse.ts (sanitizeInput, etc.).
// Do not add normalization logic here — keep it in normalize.ts.
// ---------------------------------------------------------------------------

import { nip19 } from "nostr-tools";

import { decodeBolt11Invoice } from "./bolt11";
import { isValidEcashToken as decodeIsValidEcashToken } from "./ecash";
import { logger } from "./logger";
import { decodePaymentRequestInfo } from "./payment-request";
import type { Detectors, PaymentRequestInfo } from "./types";

const tryDecode = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const LNURLP_REGEX =
  /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

// Token / request / invoice decoding all live in the canonical decoder modules
// (ecash.ts, payment-request.ts, bolt11.ts) — the detectors delegate so there
// is exactly one decode implementation in colada.

const isValidEcashToken = (v: string) => decodeIsValidEcashToken(v);

const isPaymentRequest = (v: string) => decodePaymentRequestInfo(v) !== null;

const getPaymentRequestInfo = (v: string): PaymentRequestInfo | null =>
  decodePaymentRequestInfo(v);

const isLightningInvoice = (v: string) => decodeBolt11Invoice(v) !== null;

const getLightningAmount = (inv: string): number | null =>
  decodeBolt11Invoice(inv)?.amountSat ?? null;

const isLightningAddress = (v: string) => {
  const valid = !!v && LN_ADDRESS_REGEX.test(v);
  if (valid)
    logger.debug("detectors.lightningAddress.valid", { inputLength: v.length });
  return valid;
};

const isLnurlp = (v: string) => {
  const valid = !!v && LNURLP_REGEX.test(v);
  if (valid) logger.debug("detectors.lnurlp.valid", { inputLength: v.length });
  return valid;
};

const HEX_PUBKEY_REGEX = /^[0-9a-f]{64}$/;

const parseNpub = (input: string): string | null => {
  const v = input.replace(/^nostr:/i, "").trim();
  if (!v) return null;

  // 64-char lowercase hex — a raw x-only pubkey. Wrap to npub so downstream
  // code can treat all sources uniformly.
  if (HEX_PUBKEY_REGEX.test(v)) {
    const npub = tryDecode(() => nip19.npubEncode(v));
    logger.debug("detectors.nostr.rawPubkey.checked", { valid: !!npub });
    return npub;
  }

  if (v.startsWith("npub1")) {
    const valid = tryDecode(() => nip19.decode(v))?.type === "npub";
    logger.debug("detectors.nostr.npub.checked", {
      inputLength: v.length,
      valid,
    });
    return valid ? v : null;
  }

  // nprofile/nevent/naddr all carry a pubkey alongside other data (relay
  // hints, event id, kind, etc.). We surface the author pubkey as an npub
  // so the existing openProfile flow handles them uniformly. A richer
  // detector that preserves event id / relays belongs in a follow-up.
  if (
    v.startsWith("nprofile1") ||
    v.startsWith("nevent1") ||
    v.startsWith("naddr1")
  ) {
    const decoded = tryDecode(() => nip19.decode(v));
    if (!decoded) {
      logger.warn("detectors.nostr.bech32.decodeFailed", {
        inputLength: v.length,
      });
      return null;
    }
    const pubkey =
      decoded.type === "nprofile"
        ? decoded.data.pubkey
        : decoded.type === "nevent"
          ? decoded.data.author
          : decoded.type === "naddr"
            ? decoded.data.pubkey
            : null;
    const npub = pubkey ? tryDecode(() => nip19.npubEncode(pubkey)) : null;
    logger.debug("detectors.nostr.bech32.checked", {
      inputLength: v.length,
      type: decoded.type,
      hasAuthorPubkey: !!pubkey,
      valid: !!npub,
    });
    return npub;
  }

  return null;
};

export const defaultDetectors: Detectors = {
  isValidEcashToken,
  isPaymentRequest,
  getPaymentRequestInfo,
  isLightningInvoice,
  getLightningAmount,
  isLightningAddress,
  isLnurlp,
  parseNpub,
};
