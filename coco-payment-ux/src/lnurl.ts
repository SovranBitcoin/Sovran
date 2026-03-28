// ---------------------------------------------------------------------------
// LNURL Resolution — lightning address & lnurlp → bolt11 invoice
//
// Pure fetch-based resolution. No external LNURL libraries needed.
// Uses the same address/lnurlp regex patterns as detectors.ts.
//
// Consumers call requestInvoiceFromLnurl(target, amountSats) to convert
// a lightning address or lnurlp URL into a bolt11 invoice for melt.
// ---------------------------------------------------------------------------

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

interface LightningAddress {
  username: string;
  domain: string;
}

interface LnUrlPayParams {
  callback: string;
  minSendable: number;
  maxSendable: number;
  tag: string;
}

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

export async function getLnurlPayParams(meltTarget: string): Promise<LnUrlPayParams | null> {
  const url = decodeUrlOrAddress(meltTarget);
  if (!url) return null;

  const response = await fetch(url);
  const data = await response.json();
  return data as LnUrlPayParams;
}

export async function requestInvoiceFromLnurl(
  meltTarget: string,
  amountSats: number
): Promise<string> {
  const params = await getLnurlPayParams(meltTarget);
  if (!params || !params.callback) {
    throw new Error('Invalid LNURL or lightning address');
  }

  const amountMsats = amountSats * 1000;

  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    throw new Error(
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`
    );
  }

  const response = await fetch(`${params.callback}?amount=${amountMsats}`);
  const data = await response.json();

  if (!data.pr) {
    throw new Error('No invoice returned from LNURL endpoint');
  }

  return data.pr;
}

export function isLightningInvoiceBolt11(invoice: string): boolean {
  const lower = invoice.toLowerCase().trim();
  return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt');
}
