import type { discoverMints } from '@/shared/lib/apiClient';

export const MAX_DISCOVERED_MINTS = 100;

// Discovery is untrusted input: never admit local hosts or literal IPs to
// recovery, which sends blinded messages to every admitted mint.
export function isAllowedMintHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.onion')) {
    return false;
  }
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.includes('.');
}

function normalizeMintUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

/** The injected transport owns parsing, deadlines, and network errors. */
export async function fetchDiscoveredMintUrls(
  knownUrls: readonly string[],
  fetchMints: typeof discoverMints,
  signal?: AbortSignal
): Promise<string[]> {
  if (signal?.aborted) return [];
  const result = await fetchMints({ signal });
  if (signal?.aborted || result.isErr()) return [];

  const seen = new Set(knownUrls.map(normalizeMintUrl));
  const admitted: string[] = [];
  for (const mint of result.value.mints) {
    if (admitted.length >= MAX_DISCOVERED_MINTS) break;
    if (mint.hasAudit !== true || mint.state !== 'OK') continue;
    const raw = mint.mintUrl;
    if (!raw.startsWith('https://')) continue;
    // Reject explicit ports, including :443 (URL parsing removes default ports).
    const authority = raw.slice('https://'.length).split(/[/?#]/, 1)[0]!;
    if (authority.includes(':') || authority.includes('@')) continue;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (!isAllowedMintHost(parsed.hostname) || parsed.search || parsed.hash) continue;
    const normalized = normalizeMintUrl(parsed.href);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    admitted.push(parsed.href.replace(/\/$/, ''));
  }
  return admitted;
}
