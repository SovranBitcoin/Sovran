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

import { decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';
import { nip19 } from 'nostr-tools';

import type { Detectors, PaymentRequestInfo, PaymentRequestTransport } from './types';

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
const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

const decodeBolt11 = (inv: string) => tryDecode(() => decode(inv));

const isValidEcashToken = (v: string) => tryDecode(() => getDecodedToken(v)) !== null;

const isPaymentRequest = (v: string) =>
  CREQ_PREFIX.test(v.trim()) && tryDecode(() => decodePaymentRequest(v.trim())) !== null;

const getPaymentRequestInfo = (v: string): PaymentRequestInfo | null => {
  const decoded = tryDecode(() => decodePaymentRequest(v.trim()));
  if (!decoded) return null;
  const transports: PaymentRequestTransport[] | undefined = decoded.transport?.map((t) => ({
    type: t.type,
    target: t.target ?? '',
  }));
  return {
    mints: decoded.mints ?? [],
    amount: decoded.amount,
    unit: decoded.unit ?? 'sat',
    transports,
  };
};

const isLightningInvoice = (v: string) => decodeBolt11(v) !== null;

const getLightningAmount = (inv: string): number | null => {
  const d = decodeBolt11(inv);
  const msats = d?.sections?.find((s) => s?.name === 'amount')?.value;
  const sats = msats ? msats / 1000 : 0;
  return sats > 0 ? sats : null;
};

const isLightningAddress = (v: string) => !!v && LN_ADDRESS_REGEX.test(v);

const isLnurlp = (v: string) => !!v && LNURLP_REGEX.test(v);

const parseNpub = (input: string): string | null => {
  const v = input.replace(/^nostr:/i, '');
  if (!v.startsWith('npub1')) return null;
  return tryDecode(() => nip19.decode(v))?.type === 'npub' ? v : null;
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
