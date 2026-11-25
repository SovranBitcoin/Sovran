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

/**
 * The identity two spellings of one mint share: scheme and host compared
 * without case, the path as written (`/Cashu` and `/cashu` are different
 * mints on a case-sensitive server), one trailing slash ignored.
 */
function normalizeMintUrl(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i.exec(trimmed);
  return match ? match[1]!.toLowerCase() + match[2] : trimmed;
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
  // The parsed URL is checked too: `https:///user@host:444` has an empty raw
  // authority, and URL parsing still finds the credentials and port in it.
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return null;
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

/** What the Nostr client offers a read: its relays, and a one-shot query. */
interface RelayReader {
  relayUrls(): string[];
  queryRelay(
    url: string,
    filters: readonly ReturnType<typeof mintBackupFilter>[],
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<{ events: readonly unknown[] }>;
}

/** Upper bound when no relay answers; short enough not to hold the swipe back. */
const BACKUP_RELAY_TIMEOUT_MS = 3_000;
/** Once one relay answers, give stragglers a brief window before closing them. */
const BACKUP_RELAY_GRACE_MS = 800;

/**
 * Reads a filter from every relay the client is configured with (where
 * NUT-27 wallets, cashu.me among them, publish), merged. An abort cancels
 * every underlying relay subscription at once and settles with nothing; one
 * silent relay is cut short after a brief grace window once another answers,
 * so it never stalls the recovery swipe.
 */
export function relayEventsReader(client: RelayReader): FetchRelayEvents {
  return (filter, signal) =>
    new Promise<readonly unknown[]>((resolve) => {
      if (signal?.aborted) return resolve([]);
      const urls = client.relayUrls();
      if (urls.length === 0) return resolve([]);

      const queryController = new AbortController();
      const collected: unknown[] = [];
      let remaining = urls.length;
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (events: readonly unknown[]) => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        signal?.removeEventListener('abort', onAbort);
        if (!queryController.signal.aborted) queryController.abort();
        resolve(events);
      };
      const onAbort = () => finish([]);
      signal?.addEventListener('abort', onAbort, { once: true });

      for (const url of urls) {
        void client
          .queryRelay(url, [filter], BACKUP_RELAY_TIMEOUT_MS, queryController.signal)
          .then((result) => {
            if (settled) return;
            collected.push(...result.events);
            remaining -= 1;
            if (remaining === 0) {
              finish(collected);
            } else if (!graceTimer) {
              graceTimer = setTimeout(() => finish(collected), BACKUP_RELAY_GRACE_MS);
            }
          })
          .catch(() => {
            if (settled) return;
            remaining -= 1;
            if (remaining === 0) finish(collected);
          });
      }
    });
}

/**
 * The mints "Search all mints" adds to recovery: those this seed's NUT-27
 * backup lists first (the person's own list, so the likeliest to hold their
 * money), then audited mints from the directory, de-duplicated against each
 * other and the wallet's mints, capped. Read only. The seed copy `readSeed`
 * hands over is zeroed when done, whatever happens; a missing seed, an
 * offline relay or no backup leaves just the audited list.
 */
export async function discoverRecoveryMintUrls({
  knownUrls,
  fetchMints,
  backup,
  signal,
}: {
  knownUrls: readonly string[];
  fetchMints: typeof discoverMints;
  /** Omitted when Nostr is not in this build. */
  backup?: {
    /** A copy of the wallet's 64-byte seed that this call owns, or null. */
    readSeed: () => Promise<Uint8Array | null>;
    fetchEvents: FetchRelayEvents;
  };
  signal?: AbortSignal;
}): Promise<string[]> {
  const backedUp = async (): Promise<string[]> => {
    if (!backup) return [];
    let seed: Uint8Array | null = null;
    try {
      seed = await backup.readSeed();
      if (!seed || signal?.aborted) return [];
      return await fetchBackedUpMintUrls(knownUrls, seed, backup.fetchEvents, signal);
    } catch {
      return [];
    } finally {
      seed?.fill(0);
    }
  };
  const audited = async (): Promise<string[]> => {
    try {
      return await fetchDiscoveredMintUrls(knownUrls, fetchMints, signal);
    } catch {
      return [];
    }
  };
  const [fromBackup, fromAudit] = await Promise.all([backedUp(), audited()]);
  if (signal?.aborted) return [];
  return admitAll([...fromBackup, ...fromAudit], knownUrls);
}
