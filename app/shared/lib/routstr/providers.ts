import { z } from 'zod';

import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import type { RequestControls } from 'wallet/safeFetch';

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
});

const DirectorySpine = z.looseObject({
  providers: z.array(ProviderRowSpine).max(128).default([]),
});

export interface RoutstrProvider {
  baseUrl: string;
  name: string;
  description?: string;
  version?: string;
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
