/**
 * Local NUT-04 testnut detector — replaces nagg's server-side unpaid-quote probe.
 *
 * A testnut / FakeWallet mint marks an unpaid 1-unit NUT-04 bolt11 mint quote
 * as PAID without anyone ever paying the Lightning invoice (either immediately
 * on POST or within ~1–2 seconds on GET). A real mainnet Lightning mint leaves
 * an unpaid invoice in state UNPAID.
 *
 * Known testnut hosts (`testnut.cashu.space`, `*.testnut.cashu.space`) are
 * recognized synchronously even before the first probe finishes, so test funds
 * never briefly merge into real accounts on cold boot.
 */
import { z } from 'zod';
import { parseWith } from '@sovranbitcoin/schemas';
import { fetchJson } from '@/shared/lib/apiClient';

const KNOWN_TESTNUT_HOSTS = new Set(['testnut.cashu.space', 'fake.thesimplekid.dev']);
const DEFAULT_PROBE_DELAY_MS = 2_500;
const DEFAULT_TIMEOUT_MS = 5_000;

export function isKnownTestnutHost(mintUrl: string): boolean {
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(mintUrl) ? mintUrl : `https://${mintUrl}`;
    const host = new URL(raw).hostname.toLowerCase();
    return KNOWN_TESTNUT_HOSTS.has(host) || host.endsWith('.testnut.cashu.space');
  } catch {
    return false;
  }
}

const KeysetsSchema = z.looseObject({
  keysets: z
    .array(
      z.looseObject({
        unit: z.string().optional(),
        active: z.boolean().optional(),
      })
    )
    .optional(),
});

const QuoteSchema = z.looseObject({
  quote: z.string().optional(),
  state: z.string().optional(),
  paid: z.boolean().optional(),
});

const parseKeysets = parseWith(KeysetsSchema, 'mint/v1/keysets');
const parseQuote = parseWith(QuoteSchema, 'mint/v1/mint/quote/bolt11');

type QuotePayload = z.infer<typeof QuoteSchema>;

function interpretQuoteState(payload: QuotePayload): boolean | null {
  if (payload.paid === true) return true;
  if (typeof payload.state === 'string') {
    const upper = payload.state.toUpperCase();
    if (upper === 'PAID' || upper === 'ISSUED') return true;
    if (upper === 'UNPAID') return false;
  }
  if (payload.paid === false) return false;
  return null;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!signal?.aborted);
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pickProbeUnit(
  baseUrl: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  const result = await fetchJson(
    `${baseUrl}/v1/keysets`,
    parseKeysets,
    'mint/testnut/keysets',
    { method: 'GET' },
    { signal, timeoutMs }
  );
  if (result.isErr()) return 'sat';
  const keysets = result.value.keysets ?? [];
  const activeUnits = keysets
    .filter((ks) => ks.active !== false && typeof ks.unit === 'string' && ks.unit !== 'auth')
    .map((ks) => (ks.unit as string).toLowerCase());
  if (activeUnits.includes('sat')) return 'sat';
  return activeUnits[0] ?? 'sat';
}

export interface ProbeMintTestnutOptions {
  signal?: AbortSignal;
  delayMs?: number;
  timeoutMs?: number;
}

/**
 * Probe a single mint locally via NUT-04:
 * - Returns `true` if known testnut host or unpaid 1-unit quote turns PAID.
 * - Returns `false` if unpaid quote remains UNPAID after the check delay.
 * - Returns `null` if the mint is unreachable, aborted, or unsupported.
 */
export async function probeMintTestnut(
  mintUrl: string,
  options: ProbeMintTestnutOptions = {}
): Promise<boolean | null> {
  if (isKnownTestnutHost(mintUrl)) return true;
  const { signal, delayMs = DEFAULT_PROBE_DELAY_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (signal?.aborted) return null;

  const baseUrl = mintUrl.replace(/\/+$/, '');
  const unit = await pickProbeUnit(baseUrl, timeoutMs, signal);
  if (signal?.aborted) return null;

  const created = await fetchJson(
    `${baseUrl}/v1/mint/quote/bolt11`,
    parseQuote,
    'mint/testnut/quote_create',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1, unit }),
    },
    { signal, timeoutMs }
  );
  if (created.isErr()) return null;

  const immediate = interpretQuoteState(created.value);
  if (immediate === true) return true;

  const quoteId = created.value.quote;
  if (!quoteId) return immediate;

  const completed = await abortableDelay(delayMs, signal);
  if (!completed) return null;

  const checked = await fetchJson(
    `${baseUrl}/v1/mint/quote/bolt11/${encodeURIComponent(quoteId)}`,
    parseQuote,
    'mint/testnut/quote_check',
    { method: 'GET' },
    { signal, timeoutMs }
  );
  if (checked.isErr()) return null;
  return interpretQuoteState(checked.value);
}
