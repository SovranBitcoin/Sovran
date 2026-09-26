import type NDK from '@nostr-dev-kit/ndk-mobile';
import type { NDKKind } from '@nostr-dev-kit/ndk-mobile';
import { z } from 'zod';

import { aiLog } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
export { curatedIdSet, normalizeModelId } from './lineup';

/**
 * Routstr's curated model list, published on Nostr.
 *
 * A node's `/v1/models` is whatever its operator configured, and operators do
 * not keep pace with upstreams retiring models: on 2026-09-26
 * `privateprovider.xyz` listed `tinfoil-deepseek-v4-flash`, the enclave behind
 * it answered 404 for every request, and the maintainers' reply was that the
 * model is deprecated and "we manage lists using Nostr". The list is a kind
 * 38423 replaceable event, `d: routstr-21-models`, signed by Routstr's key:
 * the model ids they currently stand behind, plus node allow and deny lists.
 * `@routstr/sdk` fetches it but, at 0.4.6, applies it to nothing.
 *
 * Here it is the allowlist the lineup is derived against (`deriveLineup`), on
 * the same rule nagg applies server-side: a vendor with at least one listed
 * model builds its tier ladder from listed models only; a vendor with none
 * keeps its full qualifying set, because an empty tab helps nobody and the
 * list is short by design. The lineup, not the catalog, is where a deprecated
 * model has to be kept out — the catalog is the node's claim, the list is the
 * network's.
 *
 * Ids are compared normalised (`normalizeModelId`): the list spells
 * `deepseek-v4.1-flash` where a node may spell `deepseek-v4-1-flash`, and
 * some nodes prefix a vendor slug.
 */

export const CURATED_MODELS_KIND = 38423;
export const CURATED_MODELS_IDENTIFIER = 'routstr-21-models';
/** Routstr's publishing key, the same one `@routstr/sdk` defaults to. */
export const ROUTSTR_MODELS_PUBKEY =
  '4ad6fa2d16e2a9b576c863b4cf7404a70d4dc320c0c447d10ad6ff58993eacc8';

/** How long a fetched list is trusted before the relays are asked again. */
export const CURATED_MODELS_TTL_MS = 6 * 60 * 60 * 1000;

const CuratedModelsSchema = z.object({
  models: z.array(z.string().max(128)).max(512),
  'blacklisted-nodes': z.array(z.string().max(512)).max(256).optional(),
  'whitelisted-nodes': z.array(z.string().max(512)).max(256).optional(),
});

export interface CuratedModels {
  /** Model ids as published, unnormalised. */
  ids: string[];
  blacklistedNodes: string[];
  whitelistedNodes: string[];
  /** The event's `created_at`, in ms. */
  updatedAt: number;
}

/** Parse the event content, or `null` when it is not the list. */
export function parseCuratedModels(
  content: string,
  createdAtSeconds: number
): CuratedModels | null {
  try {
    const parsed = CuratedModelsSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    return {
      ids: parsed.data.models,
      blacklistedNodes: parsed.data['blacklisted-nodes'] ?? [],
      whitelistedNodes: parsed.data['whitelisted-nodes'] ?? [],
      updatedAt: createdAtSeconds * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Ask the relays for the current list, or `null` when none answers.
 *
 * NDK dedupes replaceable events to the newest, so one event is the answer.
 */
export async function fetchCuratedModels(ndk: NDK): Promise<CuratedModels | null> {
  const event = await ndk.fetchEvent({
    // A Routstr-specific kind NDK's enum does not name.
    kinds: [CURATED_MODELS_KIND as NDKKind],
    authors: [ROUTSTR_MODELS_PUBKEY],
    '#d': [CURATED_MODELS_IDENTIFIER],
  });
  if (!event || event.pubkey !== ROUTSTR_MODELS_PUBKEY) return null;
  return parseCuratedModels(event.content, event.created_at ?? 0);
}

let inFlight: Promise<void> | null = null;

/**
 * Refresh the store's copy when it is missing or stale. One request at a time;
 * a failure keeps whatever list was held, since a stale list beats none.
 */
export function refreshCuratedModels(ndk: NDK, now: number = Date.now()): Promise<void> {
  const held = useRoutstrStore.getState().curatedModels;
  if (held && now - held.fetchedAt < CURATED_MODELS_TTL_MS) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const list = await fetchCuratedModels(ndk);
      if (!list) {
        aiLog.warn('ai.curated_models.unavailable', { held: held?.ids.length ?? 0 });
        return;
      }
      useRoutstrStore.getState().setCuratedModels({ ...list, fetchedAt: now });
      aiLog.info('ai.curated_models.refreshed', {
        models: list.ids.length,
        blacklistedNodes: list.blacklistedNodes.length,
        whitelistedNodes: list.whitelistedNodes.length,
        publishedAt: new Date(list.updatedAt).toISOString(),
      });
    } catch (error) {
      aiLog.warn('ai.curated_models.fetch_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
