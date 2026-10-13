/**
 * The runner as a second wallet (ADR 0033): someone who holds ecash on the
 * simulator's own mint and hands some to the person in the story. It is how a
 * story receives ecash it did not make itself, locked or not, without another
 * phone and without anything being published.
 */
import { Wallet, getEncodedToken } from '@cashu/cashu-ts';

/**
 * Ecash for `sats` from a mint, as a token. `reach` is where the runner talks
 * to the mint; `address` is what the token says its mint is, which is the
 * address the app knows it by. With `lockTo`, only the holder of that public
 * key can redeem it.
 */
export async function tokenFromMint(
  reach: string,
  address: string,
  sats: number,
  lockTo?: string
): Promise<string> {
  const wallet = new Wallet(reach, { unit: 'sat' });
  await wallet.loadMint();
  const quote = await wallet.createMintQuoteBolt11(sats);
  // The mint's pretend Lightning pays its own invoice within a moment.
  const deadline = performance.now() + 5000;
  while ((await wallet.checkMintQuoteBolt11(quote.quote)).state !== 'PAID') {
    if (performance.now() > deadline)
      throw new Error(`The mint at ${reach} did not pay its invoice.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const proofs = lockTo
    ? await wallet.ops.mintBolt11(sats, quote).asP2PK({ kind: 'P2PK', data: lockTo }).run()
    : await wallet.mintProofsBolt11(sats, quote);
  return getEncodedToken({ mint: address, proofs, unit: 'sat' });
}
