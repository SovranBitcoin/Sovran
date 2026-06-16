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

import { decodePaymentRequest, getTokenMetadata } from "@cashu/cashu-ts";
import { decode } from "@gandlaf21/bolt11-decode";
import { nip19 } from "nostr-tools";

import { amountToNumberOrUndefined } from "./amount";
import { logger } from "./logger";
import type {
  Detectors,
  PaymentRequestInfo,
  PaymentRequestTransport,
} from "./types";

const tryDecode = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const CREQ_PREFIX = /^creq[ab]/i;
const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const LNURLP_REGEX =
  /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

const decodeBolt11 = (inv: string) => tryDecode(() => decode(inv));

const isValidEcashToken = (v: string) => {
  const metadata = tryDecode(() => getTokenMetadata(v));
  const valid = metadata !== null;
  if (valid) {
    logger.debug("detectors.ecashToken.valid", { inputLength: v.length });
  }
  return valid;
};

const isPaymentRequest = (v: string) => {
  const trimmed = v.trim();
  if (!CREQ_PREFIX.test(trimmed)) return false;
  const decoded = tryDecode(() => decodePaymentRequest(trimmed));
  const valid = decoded !== null;
  logger.debug("detectors.paymentRequest.checked", {
    inputLength: trimmed.length,
    valid,
  });
  return valid;
};

const getPaymentRequestInfo = (v: string): PaymentRequestInfo | null => {
  const trimmed = v.trim();
  const decoded = tryDecode(() => decodePaymentRequest(trimmed));
  if (!decoded) {
    logger.warn("detectors.paymentRequest.info.decodeFailed", {
      inputLength: trimmed.length,
    });
    return null;
  }
  const transports: PaymentRequestTransport[] | undefined =
    decoded.transport?.map((t) => ({
      type: t.type,
      target: t.target ?? "",
    }));
  const info = {
    mints: decoded.mints ?? [],
    amount: amountToNumberOrUndefined(decoded.amount),
    unit: decoded.unit ?? "sat",
    transports,
  };
  logger.debug("detectors.paymentRequest.info.decoded", {
    inputLength: trimmed.length,
    mintCount: info.mints.length,
    hasAmount: info.amount != null,
    unit: info.unit,
    transportTypes: transports?.map((t) => t.type) ?? [],
    transportCount: transports?.length ?? 0,
  });
  return info;
};

const isLightningInvoice = (v: string) => {
  const valid = decodeBolt11(v) !== null;
  if (valid)
    logger.debug("detectors.lightningInvoice.valid", { inputLength: v.length });
  return valid;
};

const getLightningAmount = (inv: string): number | null => {
  const d = decodeBolt11(inv);
  const msats = d?.sections?.find((s) => s?.name === "amount")?.value;
  const sats = msats ? msats / 1000 : 0;
  const amount = sats > 0 ? sats : null;
  logger.debug("detectors.lightningInvoice.amount", {
    inputLength: inv.length,
    hasAmount: amount != null,
  });
  return amount;
};

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
