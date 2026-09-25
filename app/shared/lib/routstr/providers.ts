import { z } from 'zod';

import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import type { RequestControls } from 'wallet/safeFetch';

import { isE2eeModelId } from './lineup';

/**
 * The providers a user can choose between.
 *
 * Routstr nodes publish each other: every node re-serves the kind-38421
 * announcements it has seen at `GET /v1/providers/`. Coverage varies — 42
 * entries on the newer nodes, 2 on older ones — so this is a discovery hint,
 * not a registry. That is why the caller merges it with the nodes the app
 * already knows about (the one in use, the ones it has held credentials on)
 * rather than treating it as the whole world.
 */

const ProviderRowSpine = z.looseObject({
  endpoint_url: z.string().max(512).optional(),
  endpoint_urls: z.array(z.string().max(512)).max(8).optional(),
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  pubkey: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
  // The mints this provider redeems payment tokens from. Published here as
  // well as on `/v1/info`, which means a directory pass can answer "can I pay
  // this one" for every row without forty extra round trips.
  mint_urls: z.array(z.string().max(512)).max(32).optional(),
});

const DirectorySpine = z.looseObject({
  providers: z.array(ProviderRowSpine).max(128).default([]),
});

interface RoutstrProvider {
  baseUrl: string;
  name: string;
  description?: string;
  version?: string;
  /** Mints this provider accepts payment from. Empty when it publishes none,
   *  which reads as "any mint". */
  mints: string[];
}

/** Trailing slashes and a trailing `/v1` are noise — two spellings of one node
 *  must not render as two rows, or select as two different providers. */
export function normalizeNodeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Ask a node for the directory it knows.
 *
 * Only `https` endpoints are kept: a `.onion` address cannot be reached from
 * the app without Tor, and `http` would send a bearer Cashu token in the clear.
 * Returns an empty list rather than throwing — a node that does not serve the
 * directory is a normal node, not an error.
 */
export async function fetchProviderDirectory(
  nodeBaseUrl: string,
  controls: RequestControls = {}
): Promise<RoutstrProvider[]> {
  try {
    // An arbitrary node base, not the configured one, and the directory has
    // no envelope for `fetchJson` to validate.
    // eslint-disable-next-line no-restricted-globals -- see the note above
    const response = await fetch(`${normalizeNodeUrl(nodeBaseUrl)}/v1/providers/`, {
      signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
    });
    if (!response.ok) return [];
    const parsed = DirectorySpine.safeParse(await response.json());
    if (!parsed.success) return [];

    const seen = new Set<string>();
    const out: RoutstrProvider[] = [];
    for (const row of parsed.data.providers) {
      const candidate = [row.endpoint_url, ...(row.endpoint_urls ?? [])].find((u) =>
        u?.startsWith('https://')
      );
      if (!candidate) continue;
      const baseUrl = normalizeNodeUrl(candidate);
      if (seen.has(baseUrl)) continue;
      seen.add(baseUrl);
      out.push({
        baseUrl,
        name: row.name?.trim() || baseUrl.replace(/^https:\/\//, ''),
        description: row.description?.trim() || undefined,
        version: row.version,
        mints: row.mint_urls ?? [],
      });
    }
    apiLog.info('routstr.providers.discovered', { count: out.length });
    return out;
  } catch {
    // Offline, or a node that does not serve a directory. The caller still has
    // the nodes it knows about.
    return [];
  }
}

const NodeInfoSpine = z.looseObject({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  version: z.string().max(64).optional(),
  npub: z.string().max(128).optional(),
  mints: z.array(z.string().max(512)).max(32).optional(),
  onion_url: z.string().max(512).nullable().optional(),
});

export interface NodeInfo {
  name?: string;
  description?: string;
  version?: string;
  npub?: string;
  /** Mints this node will redeem a payment token from. A token minted anywhere
   *  else is refused, so this is the one field that decides whether the user
   *  can pay this provider at all. */
  mints: string[];
  /** The operator's Nostr pubkey, hex, decoded from the node's own `npub`.
   *  Hex because that is what every profile read in this app takes. */
  pubkey?: string;
  onionUrl?: string;
}

/**
 * A node's own description of itself.
 *
 * Unauthenticated and cheap. Older nodes do not serve it — routstr-core's own
 * discovery falls back to `/v1/models` and then `/` — so a `null` here means
 * "this node does not say", not "this node is broken".
 */
export async function fetchNodeInfo(
  nodeBaseUrl: string,
  controls: RequestControls = {}
): Promise<NodeInfo | null> {
  return (await fetchNodeStatus(nodeBaseUrl, controls)).info;
}

/** A responding older node is unknown, rather than falsely labelled offline. */
export async function fetchNodeStatus(
  nodeBaseUrl: string,
  controls: RequestControls = {}
): Promise<{ status: 'online' | 'offline' | 'unknown'; info: NodeInfo | null }> {
  try {
    // An arbitrary node base, not the configured one, and the payload is the
    // node's own free-form description rather than an envelope.
    // eslint-disable-next-line no-restricted-globals -- see the note above
    const response = await fetch(`${normalizeNodeUrl(nodeBaseUrl)}/v1/info`, {
      signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
    });
    if (!response.ok) return { status: response.status >= 500 ? 'offline' : 'unknown', info: null };
    const parsed = NodeInfoSpine.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return { status: 'unknown', info: null };
    const info = parsed.data;
    return {
      status: 'online',
      info: {
        name: info.name?.trim() || undefined,
        description: info.description?.trim() || undefined,
        version: info.version,
        npub: info.npub,
        pubkey: info.npub ? npubToPubkey(info.npub) || undefined : undefined,
        mints: info.mints ?? [],
        onionUrl: info.onion_url ?? undefined,
      },
    };
  } catch {
    return { status: controls.signal?.aborted ? 'unknown' : 'offline', info: null };
  }
}

const ModelSummarySpine = z.looseObject({
  data: z
    .array(z.looseObject({ id: z.string().max(256).optional(), enabled: z.boolean().optional() }))
    .max(4096),
});

export interface ProviderModelSummary {
  /** Models this provider currently serves. */
  count: number;
  /** At least one of them runs in a Tinfoil enclave, so a request to it can be
   *  sealed end to end. `isE2eeModelId` is the one spelling of that rule, and
   *  the lineup groups the same rows under `E2EE_PROVIDER_ID` — the badge and
   *  the menu have to answer from the same test, or the badge promises an
   *  encryption the app cannot offer. */
  e2ee: boolean;
}

/**
 * Summarise a provider's catalog.
 *
 * Deliberately not called from the picker. `/v1/models` is three quarters of a
 * megabyte and a directory holds forty providers, so this runs only where the
 * user has asked about one specific provider — and what it learns is recorded,
 * so the picker can show it afterwards without ever paying for it itself.
 */
export async function fetchProviderModelSummary(
  nodeBaseUrl: string,
  controls: RequestControls = {}
): Promise<ProviderModelSummary | null> {
  try {
    // An arbitrary node base, not the configured one.
    // eslint-disable-next-line no-restricted-globals -- see the note above
    const response = await fetch(`${normalizeNodeUrl(nodeBaseUrl)}/v1/models`, {
      signal: buildAbortSignal({ timeoutMs: 30_000, ...controls }),
    });
    if (!response.ok) return null;
    const parsed = ModelSummarySpine.safeParse(await response.json());
    if (!parsed.success) return null;
    const enabled = parsed.data.data.filter((model) => model.enabled !== false);
    return {
      count: enabled.length,
      e2ee: enabled.some((model) => isE2eeModelId(model.id)),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// nagg's provider directory — the list, already discovered and already probed.
// ---------------------------------------------------------------------------

/**
 * What nagg has already found out about the provider network.
 *
 * Discovery from the phone is a Nostr relay sweep plus a fan-out of HTTP
 * directory reads: correct, and slow enough that the picker opened empty and
 * filled in over several seconds. nagg runs that same sweep continuously from
 * a server, so one call returns the whole list with the health probe already
 * done. That is the first paint.
 *
 * It is a CACHE, not an oracle: `status` is what nagg saw at `checkedAt`, and
 * a provider can go down in between. `resolveProviderStatus` is where that
 * claim loses to anything this device has seen for itself.
 */
const NaggAiProviderRowSchema = z.looseObject({
  baseUrl: z.string().max(512),
  name: z.string().max(200).optional().catch(undefined),
  /** The operator's Nostr key, hex. Absent for a provider that announced
   *  itself only over HTTP. */
  pubkey: z.string().max(128).optional().catch(undefined),
  /** Null when nagg could not resolve the operator's reach, which is NOT the
   *  same as nobody following them — the row sorts differently for each. A
   *  bare `.optional()` here would let `.catch` launder that null into the
   *  same `undefined` an absent field produces. */
  followers: z.number().int().nonnegative().nullish().catch(undefined),
  /** Where that count came from. `relays` is a LOWER BOUND — relays cap
   *  results and our relay set is partial; nagg measured one operator at 2982
   *  through Vertex where the same relay scan found 174. */
  followersSource: z.enum(['graph', 'vertex', 'relays']).optional().catch(undefined),
  modelCount: z.number().int().nonnegative().optional().catch(undefined),
  /** How many of those models are sealed to an enclave. A COUNT, deliberately:
   *  on the one provider that badges itself E2EE, 9 models of 582 are sealed. */
  encryptedModelCount: z.number().int().nonnegative().optional().catch(undefined),
  mints: z.array(z.string().max(512)).max(64).optional().catch(undefined),
  status: z.enum(['online', 'offline', 'unknown']).catch('unknown'),
  checkedAt: z.string().max(64).optional().catch(undefined),
  latencyMs: z.number().nonnegative().optional().catch(undefined),
});

export const NaggAiProvidersSchema = z.object({
  providers: z
    .array(NaggAiProviderRowSchema)
    .max(256)
    .catch(() => []),
  checkedAt: z.string().max(64).optional().catch(undefined),
  ttlSeconds: z.number().int().nonnegative().optional().catch(undefined),
});

/** One directory row, normalized onto the keys the rest of the app uses. */
export interface ServerProvider {
  baseUrl: string;
  name?: string;
  pubkey?: string;
  /** Undefined when unresolved; 0 means nobody to count. */
  followers?: number;
  /** See `followersSource` on the row schema — `relays` counts are a floor. */
  followersSource?: 'graph' | 'vertex' | 'relays';
  modelCount?: number;
  encryptedModelCount?: number;
  mints: string[];
  status: 'online' | 'offline' | 'unknown';
  latencyMs?: number;
}

/**
 * Normalize nagg's rows into the app's spelling of a provider.
 *
 * The URL normalization is load-bearing, not cosmetic: nagg publishes
 * `https://ai.example.com/` and every local key — the probe cache, the store,
 * the chosen node — is `https://ai.example.com`. Without this the server's
 * row and the device's own evidence about the same provider never meet, and
 * the list renders each of them once.
 *
 * Order is preserved. nagg sorts best-first (reachable before unknown before
 * down, then by encrypted models, then by followers) and re-deriving that on
 * the phone from the same fields would only be a second opinion on the same
 * evidence.
 */
export function serverProviders(payload: {
  providers: readonly z.infer<typeof NaggAiProviderRowSchema>[];
}): ServerProvider[] {
  const seen = new Set<string>();
  const out: ServerProvider[] = [];
  for (const row of payload.providers) {
    if (!row.baseUrl.startsWith('https://')) continue;
    const baseUrl = normalizeNodeUrl(row.baseUrl);
    if (!baseUrl || seen.has(baseUrl)) continue;
    seen.add(baseUrl);
    out.push({
      baseUrl,
      name: row.name?.trim() || undefined,
      pubkey: row.pubkey?.trim() || undefined,
      followers: row.followers ?? undefined,
      followersSource: row.followersSource,
      modelCount: row.modelCount,
      encryptedModelCount: row.encryptedModelCount,
      mints: row.mints ?? [],
      status: row.status,
      latencyMs: row.latencyMs,
    });
  }
  return out;
}
