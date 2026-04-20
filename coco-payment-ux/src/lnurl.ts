// ---------------------------------------------------------------------------
// LNURL Resolution — lightning address & lnurlp → bolt11 invoice
//
// Pure fetch-based resolution. No external LNURL libraries needed.
// Uses the same address/lnurlp regex patterns as detectors.ts.
//
// Consumers call requestInvoiceFromLnurl(target, amountSats) to convert
// a lightning address or lnurlp URL into a bolt11 invoice for melt.
// ---------------------------------------------------------------------------

import {
  LnurlInvoiceCallback,
  LnurlPayParams as LnurlPayParamsSchema,
  parseWith,
  loggableIssues,
  type LnurlPayParams,
} from '@sovranbitcoin/schemas';

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

interface LightningAddress {
  username: string;
  domain: string;
}

const parsePayParams = parseWith(LnurlPayParamsSchema, 'lnurl/pay-params');
const parseInvoiceCallback = parseWith(LnurlInvoiceCallback, 'lnurl/invoice-callback');

export function parseLightningAddress(address: string): LightningAddress | null {
  if (!address) return null;
  const result = LN_ADDRESS_REGEX.exec(address);
  return result ? { username: result[1], domain: result[2] } : null;
}

export function parseLnurlp(url: string): string | null {
  if (!url) return null;
  if (!LNURLP_REGEX.test(url.toLowerCase())) return null;
  const withoutProtocol = url.replace(/^lnurlp:\/\//i, '');
  const slashIndex = withoutProtocol.indexOf('/');
  const protocol = withoutProtocol.toLowerCase().includes('.onion') ? 'http://' : 'https://';
  if (slashIndex === -1) {
    return `${protocol}${withoutProtocol.toLowerCase()}`;
  }
  const domain = withoutProtocol.slice(0, slashIndex).toLowerCase();
  const path = withoutProtocol.slice(slashIndex);
  return `${protocol}${domain}${path}`;
}

export function decodeUrlOrAddress(meltTarget: string): string | null {
  const address = parseLightningAddress(meltTarget);
  if (address) {
    const { username, domain } = address;
    const protocol = domain.match(/\.onion$/) ? 'http' : 'https';
    return `${protocol}://${domain}/.well-known/lnurlp/${username}`;
  }
  return parseLnurlp(meltTarget);
}

export async function getLnurlPayParams(meltTarget: string): Promise<LnurlPayParams | null> {
  const url = decodeUrlOrAddress(meltTarget);
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) {
    console.warn('[LNURL] HTTP error fetching pay params:', response.status, response.statusText);
    return null;
  }
  const raw = await response.json();
  const parsed = parsePayParams(raw);
  if (parsed.isErr()) {
    console.warn('[LNURL] Invalid pay params shape', {
      issues: loggableIssues(parsed.error),
    });
    return null;
  }
  return parsed.value;
}

export async function requestInvoiceFromLnurl(
  meltTarget: string,
  amountSats: number
): Promise<string> {
  console.info('[LNURL] Resolving invoice | target:', meltTarget.slice(0, 40), '| amount:', amountSats, 'sats');
  const params = await getLnurlPayParams(meltTarget);
  if (!params || !params.callback) {
    console.warn('[LNURL] Invalid params for target:', meltTarget, '| params:', params);
    throw new Error('Invalid LNURL or lightning address');
  }

  const amountMsats = amountSats * 1000;

  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    console.warn('[LNURL] Amount out of range:', amountSats, 'sats | min:', params.minSendable / 1000, '| max:', params.maxSendable / 1000);
    throw new Error(
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`
    );
  }

  const response = await fetch(`${params.callback}?amount=${amountMsats}`);
  const raw = await response.json();
  const parsed = parseInvoiceCallback(raw);
  if (parsed.isErr()) {
    console.warn('[LNURL] Invalid invoice callback shape', {
      callback: params.callback,
      issues: loggableIssues(parsed.error),
    });
    throw new Error('No invoice returned from LNURL endpoint');
  }

  console.info('[LNURL] Invoice received | length:', parsed.value.pr.length);
  return parsed.value.pr;
}

export function isLightningInvoiceBolt11(invoice: string): boolean {
  const lower = invoice.toLowerCase().trim();
  return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt');
}
