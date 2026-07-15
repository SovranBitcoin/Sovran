/**
 * Valueless test mints — mints whose sats are worthless by construction
 * (testnut runs a fake Lightning backend and hands out free ecash).
 *
 * Assets at these mints are exempt from the funded custody guarantee: the
 * harness never scans/sweeps them back to cocod, and any unexplained principal
 * is automatically written off as `valueless-test-mint` instead of
 * quarantining the harness. Real-money invariants (typed counterparty steps,
 * principal caps, funded-lane gating) still apply so scenario authoring stays
 * uniform; only the recovery/conservation ceremony is waived.
 *
 * Additions to this list must be mints that can never custody real value.
 */
export const VALUELESS_TEST_MINT_HOSTS: ReadonlySet<string> = new Set([
  'testnut.cashu.space',
  'nofees.testnut.cashu.space',
]);

export const VALUELESS_WRITE_OFF_REASON = 'valueless-test-mint';

export function isValuelessTestMint(mintUrl: string): boolean {
  try {
    return VALUELESS_TEST_MINT_HOSTS.has(new URL(mintUrl).host);
  } catch {
    return false;
  }
}
