/**
 * What a story is handed before it starts that the app cannot make for
 * itself: something from the outside world, fetched fresh for each play. A
 * Lightning invoice to pay is the first. The story names it under `given` and
 * uses it as `{{invoice}}` in the text it types.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalMint } from './localMint';
import type { Story } from './story';

/** In place of a mint's address: a private mint on this machine. */
const LOCAL = 'local';

interface MintQuote {
  request?: string;
}

/**
 * Ask a mint for an invoice. `local` is a private mint started for the moment
 * it takes to ask: its invoices are real ones that nobody has paid, which is
 * what a story about paying needs. (The public test mint marks its own
 * invoices paid at once, so paying one of those is refused as already paid.)
 */
async function invoiceFrom(mint: string, sats: number, paying?: 'pending'): Promise<string> {
  if (mint !== LOCAL) return invoiceFromMint(mint, sats);
  const dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-invoice-'));
  // A port of this process's own, so runners side by side do not collide.
  const local = await startLocalMint(dir, 20_000 + (process.pid % 20_000));
  try {
    return await invoiceFromMint(local.url, sats, paying && PAYING[paying]);
  } finally {
    local.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What the pretend Lightning of `cdk-mintd` reads from an invoice's
 * description when asked to pay it: the outcome to report.
 */
const PAYING = {
  pending: JSON.stringify({
    pay_invoice_state: 'PENDING',
    check_payment_state: 'PENDING',
    pay_err: false,
    check_err: false,
  }),
};

async function invoiceFromMint(mint: string, sats: number, description?: string): Promise<string> {
  // eslint-disable-next-line no-restricted-globals -- the runner asking a test mint, outside the app
  const answered = await fetch(`${mint.replace(/\/$/, '')}/v1/mint/quote/bolt11`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: sats, unit: 'sat', ...(description ? { description } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const quote = (await answered.json()) as MintQuote;
  if (!answered.ok || !quote.request)
    throw new Error(`${mint} gave no invoice for ${sats} sats (status ${answered.status}).`);
  return quote.request;
}

/**
 * The story with everything it was given put in place of its `{{name}}` marks,
 * wherever they are written: text to type, the id of a row, a label. `known`
 * is what the runner already has for it, such as the address of the
 * simulator's own mint (`{{mint}}`).
 */
export async function withGiven(
  story: Story,
  known: Record<string, string> = {},
  fetchInvoice: (mint: string, sats: number, paying?: 'pending') => Promise<string> = invoiceFrom
): Promise<Story> {
  const given: Record<string, string> = { ...known };
  if (story.given?.invoice)
    given.invoice = await fetchInvoice(
      story.given.invoice.mint,
      story.given.invoice.sats,
      story.given.invoice.paying
    );
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(/\{\{(\w+)\}\}/g, (mark, name: string) => {
        // Left as written: a later step may fill it from what an earlier one remembered.
        return name in given ? given[name] : mark;
      });
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, fill(each)]));
    return value;
  };
  return { ...story, steps: fill(story.steps) as Story['steps'] };
}
