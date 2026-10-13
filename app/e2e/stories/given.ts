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
async function invoiceFrom(mint: string, sats: number): Promise<string> {
  if (mint !== LOCAL) return invoiceFromMint(mint, sats);
  const dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-invoice-'));
  // A port of this process's own, so runners side by side do not collide.
  const local = await startLocalMint(dir, 20_000 + (process.pid % 20_000));
  try {
    return await invoiceFromMint(local.url, sats);
  } finally {
    local.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function invoiceFromMint(mint: string, sats: number): Promise<string> {
  // eslint-disable-next-line no-restricted-globals -- the runner asking a test mint, outside the app
  const answered = await fetch(`${mint.replace(/\/$/, '')}/v1/mint/quote/bolt11`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: sats, unit: 'sat' }),
    signal: AbortSignal.timeout(15_000),
  });
  const quote = (await answered.json()) as MintQuote;
  if (!answered.ok || !quote.request)
    throw new Error(`${mint} gave no invoice for ${sats} sats (status ${answered.status}).`);
  return quote.request;
}

/** The story with everything it was given put in place of its `{{name}}` marks. */
export async function withGiven(
  story: Story,
  fetchInvoice: (mint: string, sats: number) => Promise<string> = invoiceFrom
): Promise<Story> {
  const given: Record<string, string> = {};
  if (story.given?.invoice)
    given.invoice = await fetchInvoice(story.given.invoice.mint, story.given.invoice.sats);
  return {
    ...story,
    steps: story.steps.map((step) => {
      if (!step.type) return step;
      const text = step.type.text.replace(/\{\{(\w+)\}\}/g, (mark, name: string) => {
        if (!(name in given)) throw new Error(`The story types ${mark} but was given no ${name}.`);
        return given[name];
      });
      return { ...step, type: { ...step.type, text } };
    }),
  };
}
