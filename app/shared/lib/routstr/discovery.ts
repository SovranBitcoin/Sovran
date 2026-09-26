import { facade } from 'nostr';

import { apiLog } from '@/shared/lib/logger';
import type { RequestControls } from 'wallet/safeFetch';

import { fetchProviderDirectory, normalizeNodeUrl, type RoutstrProvider } from './providers';

/**
 * Find Routstr providers the way Routstr's own clients do.
 *
 * Providers announce themselves on Nostr as kind-38421 addressable events, and
 * every routstr client — the SDK's `ModelManager`, routstr-chat — reads that
 * kind to build its provider list. Asking one node's `/v1/providers/` was a
 * strictly smaller question: it returns only what THAT node has seen, and when
 * the node is unreachable, or too old to serve the route, it returns nothing.
 * That is why a picker that should list dozens listed one.
 *
 * Both sources are used. Nostr is the registry; the HTTP directories add the
 * accepted-mint lists, which the announcements do not always carry and which
 * decide whether the user can pay a provider at all.
 */

/** Where routstr publishes. Matches `DEFAULT_NOSTR_RELAYS` in `@routstr/sdk`,
 *  so this app reads the same set its clients write to. */
const DISCOVERY_RELAYS = ['wss://relay.routstr.com', 'wss://relay.damus.io', 'wss://nos.lol'];

/** Kind 38421 — the provider announcement. */
const PROVIDER_ANNOUNCEMENT_KIND = 38421;

/** Relays hold years of announcements and the kind is not exclusive to
 *  routstr, so the subscription is bounded and the results are filtered. */
const ANNOUNCEMENT_LIMIT = 300;

const RELAY_TIMEOUT_MS = 12_000;

interface AnnouncedProvider {
  baseUrl: string;
  name?: string;
  description?: string;
  mints?: string[];
  /**
   * Who SIGNED the announcement — never a pubkey the content merely names.
   *
   * An announcement can only speak for the key that signed it. Kind 38421 is
   * a public kind with no ownership of the endpoints it lists, so honouring a
   * `pubkey` field inside the content let anyone publish an event naming
   * another operator's node and take over the "Run by" line on their row.
   */
  pubkey?: string;
  /** When the announcement was published. A provider nobody has re-announced
   *  in a long time is still listed, but it is worth knowing. */
  announcedAt?: number;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Only `https` survives. A `.onion` address cannot be reached without Tor,
 *  and `http` would put a bearer Cashu token on the wire in the clear. */
function usableEndpoint(url: unknown): string | null {
  const candidate = asString(url);
  if (!candidate?.startsWith('https://')) return null;
  return normalizeNodeUrl(candidate);
}

type RelayEvent = facade.relay.RawRelayEvent;

function tagValues(event: RelayEvent, name: string): string[] {
  if (!Array.isArray(event.tags)) return [];
  const out: string[] = [];
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === 'string') out.push(tag[1]);
  }
  return out;
}

/**
 * Read the providers out of one announcement.
 *
 * Two shapes are in the wild and both are honoured, same as the SDK: `u` tags
 * carrying endpoints, or JSON content holding a directory. Kind 38421 is not
 * exclusive to routstr — `lnproxy-v1` advertises on it too — so an event with
 * neither shape yields nothing rather than a bogus row.
 */
function readAnnouncement(event: RelayEvent): AnnouncedProvider[] {
  const announcedAt = typeof event.created_at === 'number' ? event.created_at * 1000 : undefined;
  const fromTags = tagValues(event, 'u')
    .map(usableEndpoint)
    .filter((url): url is string => url != null);
  if (fromTags.length > 0) {
    const name = asString(tagValues(event, 'name')[0]);
    const pubkey = asString(event.pubkey);
    return fromTags.map((baseUrl) => ({ baseUrl, name, pubkey, announcedAt }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content ?? '');
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { providers?: unknown })?.providers)
      ? ((parsed as { providers: unknown[] }).providers ?? [])
      : [];
  const out: AnnouncedProvider[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const endpoints = [
      entry.endpoint_url,
      ...(Array.isArray(entry.endpoint_urls) ? entry.endpoint_urls : []),
    ];
    const baseUrl = endpoints.map(usableEndpoint).find((url): url is string => url != null);
    if (!baseUrl) continue;
    out.push({
      baseUrl,
      name: asString(entry.name),
      description: asString(entry.description),
      pubkey: asString(event.pubkey),
      mints: Array.isArray(entry.mint_urls)
        ? entry.mint_urls.filter((m): m is string => typeof m === 'string')
        : undefined,
      announcedAt,
    });
  }
  return out;
}

/** Ask the relays who is out there. Never throws: an unreachable relay set
 *  means the HTTP directories carry the list on their own. */
async function fromNostr(controls: RequestControls = {}): Promise<AnnouncedProvider[]> {
  const connection = facade.relay.createRelayPoolConnection({ relays: DISCOVERY_RELAYS });
  const result = await connection.request(
    [{ kinds: [PROVIDER_ANNOUNCEMENT_KIND], limit: ANNOUNCEMENT_LIMIT }],
    { timeoutMs: RELAY_TIMEOUT_MS, ...controls }
  );
  if (result.isErr()) {
    apiLog.warn('routstr.discovery.relays_failed', { relays: DISCOVERY_RELAYS.length });
    return [];
  }
  const out = result.value.flatMap(readAnnouncement);
  apiLog.info('routstr.discovery.nostr', { events: result.value.length, providers: out.length });
  return out;
}

/**
 * Everything the network says, kept apart by who said it.
 *
 * It used to be merged here into one row per provider, last writer winning —
 * and because the HTTP directories were absorbed after the announcements, a
 * peer node's opinion overwrote the operator's own. Two sweeps 13ms apart
 * merged 50 and 45 announcements into 38 and 37 rows, so the same list came
 * out differently on each open.
 *
 * Nothing is merged now. The store ranks these by authority per field
 * (`providerClaims.ts`), which is the question the merge was failing to ask.
 */
interface Discovery {
  /** Self-signed, so this is where operator identity comes from. */
  announced: AnnouncedProvider[];
  /** Other nodes describing their peers. Hearsay — useful for accepted-mint
   *  lists, which announcements often omit, and for nothing about identity. */
  peers: RoutstrProvider[];
}

export async function discoverProviders(
  knownNodes: string[],
  controls: RequestControls = {}
): Promise<Discovery> {
  // Side by side. The relay sweep used to be queued behind the whole HTTP
  // fan-out, which added its 12-second ceiling to theirs for no reason: they
  // answer different questions and neither needs the other's result.
  const [announced, directories] = await Promise.all([
    fromNostr(controls),
    Promise.all(
      // Every node we know is asked, not just the one in use: directories
      // differ, and the node in use is exactly the one that might be down.
      [...new Set(knownNodes.map(normalizeNodeUrl))]
        .filter(Boolean)
        .slice(0, 8)
        .map((node) => fetchProviderDirectory(node, controls))
    ),
  ]);
  const peers = directories.flat();
  apiLog.info('routstr.discovery.merged', {
    announced: announced.length,
    peers: peers.length,
    directories: directories.length,
  });
  return { announced, peers };
}
