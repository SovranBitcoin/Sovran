/**
 * Pure leaf predicate for canonical testnut hosts (zero imports so stores like
 * `mintTestnutStore` never pull in `apiClient`, `nostr`, or `cashu-ts`).
 */

const KNOWN_TESTNUT_HOSTS = new Set(['testnut.cashu.space', 'fake.thesimplekid.dev']);

export function isKnownTestnutHost(mintUrl: string): boolean {
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(mintUrl) ? mintUrl : `https://${mintUrl}`;
    const host = new URL(raw).hostname.toLowerCase();
    return KNOWN_TESTNUT_HOSTS.has(host) || host.endsWith('.testnut.cashu.space');
  } catch {
    return false;
  }
}
