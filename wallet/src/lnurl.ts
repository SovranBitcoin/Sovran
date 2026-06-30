// ---------------------------------------------------------------------------
// LNURL Resolution — lightning address & lnurlp → bolt11 invoice
//
// Pure fetch-based resolution. No external LNURL libraries needed.
// Uses the same address/lnurlp regex patterns as detectors.ts.
//
// Consumers call requestInvoiceFromLnurl(target, amountSats) to convert
// a lightning address or lnurlp URL into a bolt11 invoice for melt.
//
// External-server hardening (LUD-06):
//   • Every fetch is bounded by a timeout + caller AbortSignal so a
//     stalled server cannot wedge the melt flow indefinitely.
//   • The callback URL is composed via `URL.searchParams.set('amount', …)`
//     so a callback that already carries query params (`?token=…`) is
//     handled correctly — naive concat would produce a double-`?` URL.
//   • The callback URL's protocol is locked to `https:` (or `http:` for
//     `.onion`) so a hostile pay-params payload cannot downgrade the
//     transport mid-flow.
//   • The returned bolt11 is decoded and its msat amount is asserted to
//     match the caller's request. A malicious LN-address provider that
//     returns a bolt11 encoding 100k sats when the user asked for 100
//     would otherwise reach `mgr.ops.melt.prepare` and drain the user.
// ---------------------------------------------------------------------------

import { decode } from '@gandlaf21/bolt11-decode';
import {
  LnurlInvoiceCallback,
  LnurlPayParams as LnurlPayParamsSchema,
  parseWith,
  loggableIssues,
  type LnurlPayParams,
} from '@sovranbitcoin/schemas';

import { errField, logger } from './logger';
import { isAbortError, safeFetch, type RequestControls } from './safeFetch';

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX =
  /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

interface LightningAddress {
  username: string;
  domain: string;
}

const parsePayParams = parseWith(LnurlPayParamsSchema, 'lnurl/pay-params');
const parseInvoiceCallback = parseWith(
  LnurlInvoiceCallback,
  'lnurl/invoice-callback',
);

/**
 * Distinct LNURL failure codes so the caller (machine + UI) can route
 * each case — generic "fetch failed" hides amount-mismatch attacks.
 */
export type LnurlErrorCode =
  | 'LNURL_INVALID_TARGET'
  | 'LNURL_PARAMS_FETCH_FAILED'
  | 'LNURL_INVALID_PARAMS'
  | 'LNURL_AMOUNT_OUT_OF_RANGE'
  | 'LNURL_INSECURE_CALLBACK'
  | 'LNURL_INVOICE_FETCH_FAILED'
  | 'LNURL_INVALID_INVOICE_RESPONSE'
  | 'LNURL_INVOICE_AMOUNT_MISMATCH'
  | 'LNURL_TOR_REQUIRED'
  | 'LNURL_TIMEOUT';

function isOnionHost(host: string): boolean {
  return host.toLowerCase().endsWith('.onion');
}

function summarizeTarget(target: string): Record<string, unknown> {
  const address = parseLightningAddress(target);
  if (address) {
    return {
      targetType: 'lightningAddress',
      inputLength: target.length,
      usernameLength: address.username.length,
      domain: address.domain,
    };
  }
  const url = parseLnurlp(target);
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        targetType: 'lnurlp',
        inputLength: target.length,
        host: parsed.host,
        pathnameLength: parsed.pathname.length,
      };
    } catch {
      return {
        targetType: 'lnurlp',
        inputLength: target.length,
        host: null,
        pathnameLength: 0,
      };
    }
  }
  return { targetType: 'unknown', inputLength: target.length };
}

function summarizeCallbackUrl(url: URL): Record<string, unknown> {
  return {
    protocol: url.protocol.replace(/:$/, ''),
    host: url.host,
    pathnameLength: url.pathname.length,
    queryKeyCount: Array.from(url.searchParams.keys()).length,
    queryKeys: Array.from(new Set(Array.from(url.searchParams.keys()))),
  };
}

export class LnurlError extends Error {
  readonly code: LnurlErrorCode;
  constructor(code: LnurlErrorCode, message: string) {
    super(message);
    this.name = 'LnurlError';
    this.code = code;
  }
}

export function parseLightningAddress(
  address: string,
): LightningAddress | null {
  if (!address) return null;
  const result = LN_ADDRESS_REGEX.exec(address);
  return result ? { username: result[1], domain: result[2] } : null;
}

export function parseLnurlp(url: string): string | null {
  if (!url) return null;
  if (!LNURLP_REGEX.test(url.toLowerCase())) return null;
  const withoutProtocol = url.replace(/^lnurlp:\/\//i, '');
  const slashIndex = withoutProtocol.indexOf('/');
  const protocol = withoutProtocol.toLowerCase().includes('.onion')
    ? 'http://'
    : 'https://';
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

/**
 * Reject an LNURL callback whose protocol disagrees with its host. A
 * callback returned from a lightning address that suddenly switches to
 * `http://` on a clearnet host is a transport downgrade — the caller's
 * pay-params fetch was https, so the callback must be too.
 */
function assertSecureCallback(callback: string): URL {
  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    logger.warn('lnurl.callback.invalidUrl', {
      callbackLength: callback.length,
    });
    throw new LnurlError(
      'LNURL_INVALID_PARAMS',
      'LNURL callback is not a valid URL',
    );
  }
  const isOnion = url.hostname.endsWith('.onion');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isOnion)) {
    logger.warn('lnurl.callback.insecure', {
      ...summarizeCallbackUrl(url),
      isOnion,
    });
    throw new LnurlError(
      'LNURL_INSECURE_CALLBACK',
      'LNURL callback protocol must be https (or http for .onion)',
    );
  }
  logger.debug('lnurl.callback.secure', {
    ...summarizeCallbackUrl(url),
    isOnion,
  });
  return url;
}

/**
 * Pull the millisat amount out of a decoded bolt11. Zero-amount
 * invoices return `null`; LUD-06 forbids those, so the caller treats
 * `null` as a mismatch.
 */
function decodedInvoiceMsats(invoice: string): number | null {
  try {
    const decoded = decode(invoice);
    const section = decoded?.sections?.find(
      (s: { name?: string }) => s?.name === 'amount',
    );
    const value = section?.value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (typeof value === 'number') {
      return value > 0 ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getLnurlPayParams(
  meltTarget: string,
  controls: RequestControls = {},
): Promise<LnurlPayParams | null> {
  logger.info('lnurl.payParams.start', {
    ...summarizeTarget(meltTarget),
    hasSignal: !!controls.signal,
    signalAborted: controls.signal?.aborted === true,
    timeoutMs: controls.timeoutMs ?? null,
  });
  const url = decodeUrlOrAddress(meltTarget);
  if (!url) {
    logger.info('lnurl.payParams.skipped', {
      reason: 'invalid_target',
      inputLength: meltTarget.length,
    });
    return null;
  }

  // RN/iOS/Android can't resolve .onion at the OS level, so the fetch fails
  // with a generic "Network request failed" error that the wallet surfaces
  // as a parse-style error. Reject up-front with a distinct code so the UI
  // can show "Tor is not supported" instead of a misleading generic failure.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    logger.warn('lnurl.payParams.invalidUrl', {
      ...summarizeTarget(meltTarget),
    });
    return null;
  }
  if (isOnionHost(parsedUrl.hostname)) {
    logger.warn('lnurl.payParams.torRequired', {
      host: parsedUrl.host,
      pathnameLength: parsedUrl.pathname.length,
    });
    throw new LnurlError(
      'LNURL_TOR_REQUIRED',
      'LNURL target requires Tor (.onion host)',
    );
  }

  let response: Response;
  try {
    response = await safeFetch(url, controls);
  } catch (e) {
    if (isAbortError(e)) {
      logger.warn('lnurl.payParams.timeout', {
        host: parsedUrl.host,
        pathnameLength: parsedUrl.pathname.length,
      });
      throw new LnurlError('LNURL_TIMEOUT', 'LNURL pay-params timed out');
    }
    logger.warn('lnurl.payParams.fetchFailed', {
      host: parsedUrl.host,
      pathnameLength: parsedUrl.pathname.length,
      error: errField(e),
    });
    return null;
  }

  if (!response.ok) {
    logger.warn('lnurl.payParams.httpError', {
      host: parsedUrl.host,
      pathnameLength: parsedUrl.pathname.length,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }
  const raw = await response.json();
  const parsed = parsePayParams(raw);
  if (parsed.isErr()) {
    logger.warn('lnurl.payParams.invalidShape', {
      host: parsedUrl.host,
      pathnameLength: parsedUrl.pathname.length,
      issues: loggableIssues(parsed.error),
    });
    return null;
  }
  logger.info('lnurl.payParams.done', {
    host: parsedUrl.host,
    pathnameLength: parsedUrl.pathname.length,
    minSendable: parsed.value.minSendable,
    maxSendable: parsed.value.maxSendable,
    hasCallback: !!parsed.value.callback,
  });
  return parsed.value;
}

export async function requestInvoiceFromLnurl(
  meltTarget: string,
  amountSats: number,
  controls: RequestControls = {},
): Promise<string> {
  logger.info('lnurl.invoice.start', {
    ...summarizeTarget(meltTarget),
    amountSats,
    hasSignal: !!controls.signal,
    signalAborted: controls.signal?.aborted === true,
    timeoutMs: controls.timeoutMs ?? null,
  });
  const params = await getLnurlPayParams(meltTarget, controls);
  if (!params || !params.callback) {
    logger.warn('lnurl.invoice.invalidTarget', {
      ...summarizeTarget(meltTarget),
      hasParams: !!params,
      hasCallback: !!params?.callback,
    });
    throw new LnurlError(
      'LNURL_INVALID_TARGET',
      'Invalid LNURL or lightning address',
    );
  }

  const amountMsats = amountSats * 1000;

  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    logger.warn('lnurl.invoice.amountOutOfRange', {
      amountSats,
      amountMsats,
      minSendable: params.minSendable,
      maxSendable: params.maxSendable,
    });
    throw new LnurlError(
      'LNURL_AMOUNT_OUT_OF_RANGE',
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`,
    );
  }

  const callbackUrl = assertSecureCallback(params.callback);
  callbackUrl.searchParams.set('amount', String(amountMsats));
  logger.info('lnurl.invoice.callback', {
    ...summarizeCallbackUrl(callbackUrl),
    amountMsats,
  });

  let response: Response;
  try {
    response = await safeFetch(callbackUrl.toString(), controls);
  } catch (e) {
    if (isAbortError(e)) {
      logger.warn('lnurl.invoice.timeout', {
        ...summarizeCallbackUrl(callbackUrl),
      });
      throw new LnurlError(
        'LNURL_TIMEOUT',
        `LNURL invoice fetch timed out for ${callbackUrl.host}`,
      );
    }
    logger.warn('lnurl.invoice.fetchFailed', {
      ...summarizeCallbackUrl(callbackUrl),
      errorName: e instanceof Error ? e.name : typeof e,
    });
    throw new LnurlError(
      'LNURL_INVOICE_FETCH_FAILED',
      'LNURL invoice fetch failed',
    );
  }

  if (!response.ok) {
    logger.warn('lnurl.invoice.httpError', {
      ...summarizeCallbackUrl(callbackUrl),
      status: response.status,
      statusText: response.statusText,
    });
    throw new LnurlError(
      'LNURL_INVOICE_FETCH_FAILED',
      `LNURL invoice fetch HTTP ${response.status} ${response.statusText}`,
    );
  }

  const raw = await response.json();
  const parsed = parseInvoiceCallback(raw);
  if (parsed.isErr()) {
    logger.warn('lnurl.invoiceCallback.invalidShape', {
      ...summarizeCallbackUrl(callbackUrl),
      issues: loggableIssues(parsed.error),
    });
    throw new LnurlError(
      'LNURL_INVALID_INVOICE_RESPONSE',
      'No invoice returned from LNURL endpoint',
    );
  }

  const invoice = parsed.value.pr;
  const decodedMsats = decodedInvoiceMsats(invoice);
  if (decodedMsats !== amountMsats) {
    logger.warn('lnurl.invoice.amountMismatch', {
      ...summarizeCallbackUrl(callbackUrl),
      requestedMsats: amountMsats,
      decodedMsats,
      invoiceLength: invoice.length,
    });
    throw new LnurlError(
      'LNURL_INVOICE_AMOUNT_MISMATCH',
      `LNURL server returned an invoice for ${decodedMsats ?? 0} msats; requested ${amountMsats} msats`,
    );
  }

  logger.info('lnurl.invoice.done', {
    ...summarizeCallbackUrl(callbackUrl),
    amountMsats,
    invoiceLength: invoice.length,
  });
  return invoice;
}

export function isLightningInvoiceBolt11(invoice: string): boolean {
  const lower = invoice.toLowerCase().trim();
  logger.debug('lnurl.invoice.kindChecked', {
    invoiceLength: invoice.length,
    trimmedLength: lower.length,
    bolt11:
      lower.startsWith('lnbc') ||
      lower.startsWith('lntbs') ||
      lower.startsWith('lntb') ||
      lower.startsWith('lnbcrt'),
  });
  return (
    lower.startsWith('lnbc') ||
    lower.startsWith('lntbs') ||
    lower.startsWith('lntb') ||
    lower.startsWith('lnbcrt')
  );
}
