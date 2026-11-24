import type { discoverMints } from '@/shared/lib/apiClient';
import {
  deriveMintBackupKeys,
  latestMintBackup,
  mintBackupFilter,
} from '@/shared/lib/cashu/nut27MintBackup';

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

/**
 * The URL recovery may probe for `raw`, or null. Only plain `https://` hosts
 * on the public internet: no explicit port (including :443, which URL parsing
 * would hide), no credentials, query or fragment.
 */
function admitMintUrl(raw: string): string | null {
  if (!raw.startsWith('https://')) return null;
  const authority = raw.slice('https://'.length).split(/[/?#]/, 1)[0]!;
  if (authority.includes(':') || authority.includes('@')) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!isAllowedMintHost(parsed.hostname) || parsed.search || parsed.hash) return null;
  return parsed.href.replace(/\/$/, '');
}

/** Admitted, de-duplicated against `knownUrls` and each other, capped. */
function admitAll(candidates: Iterable<string>, knownUrls: readonly string[]): string[] {
  const seen = new Set(knownUrls.map(normalizeMintUrl));
  const admitted: string[] = [];
  for (const raw of candidates) {
    if (admitted.length >= MAX_DISCOVERED_MINTS) break;
    const url = admitMintUrl(raw);
    if (!url) continue;
    const normalized = normalizeMintUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    admitted.push(url);
  }
  return admitted;
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
  const audited = result.value.mints
    .filter((mint) => mint.hasAudit === true && mint.state === 'OK')
    .map((mint) => mint.mintUrl);
  return admitAll(audited, knownUrls);
}

/** Reads relay events for a filter; owns relays, deadlines and network errors. */
type FetchRelayEvents = (
  filter: ReturnType<typeof mintBackupFilter>,
  signal?: AbortSignal
) => Promise<readonly unknown[]>;

/**
 * Mints a NUT-27 backup lists for this wallet seed: the list cashu.me and
 * other NUT-27 wallets publish, found with the key the seed derives. Read
 * only: nothing is published or saved. A relay answer is untrusted, so the
 * newest event signed by the derived key that decrypts is used, and its URLs
 * pass the same admission as discovered mints. No backup, a failed read or an
 * abort is an empty list, never an error.
 */
export async function fetchBackedUpMintUrls(
  knownUrls: readonly string[],
  seed: Uint8Array,
  fetchEvents: FetchRelayEvents,
  signal?: AbortSignal
): Promise<string[]> {
  if (signal?.aborted) return [];
  const keys = deriveMintBackupKeys(seed);
  try {
    let events: readonly unknown[];
    try {
      events = await fetchEvents(mintBackupFilter(keys.publicKeyHex), signal);
    } catch {
      return [];
    }
    if (signal?.aborted) return [];
    const backup = latestMintBackup(keys, events);
    return backup ? admitAll(backup.mints, knownUrls) : [];
  } finally {
    keys.privateKey.fill(0);
  }
}
