import { createNaggClient, setNostrLogger, facade, type NostrLogger } from '@sovranbitcoin/nagg-ts';

import { log } from '@/shared/lib/logger';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import {
  cachedProfileToMetadata,
  useNostrMetadataCache,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';

// Debounce window for mirroring the entity cache to durable storage. Coarse
// enough that active browsing doesn't thrash AsyncStorage; fine enough that a
// freshly-seen contact persists well before the next cold start.
const WRITE_BEHIND_DEBOUNCE_MS = 5_000;

// ---------------------------------------------------------------------------
// The tier-selecting Nostr data-layer facade — a PROFILE-SCOPED SINGLETON.
//
// One shared facade (and therefore one shared entity cache) is memoised per
// active profile + tier configuration. Every caller — feed, thread, DM, profile
// search — gets the SAME instance, so a profile fetched for search instantly
// renders in the feed, and a note seen in the feed opens as a thread with no
// refetch. (Previously each call built a fresh facade with a fresh cache, so the
// cache never accumulated across reads.)
//
// On identity switch the active pubkey changes, so the memo misses and the old
// profile-scoped cache is cleared and replaced — one account never serves
// another's cached data (ADR-0002). Tier toggles (Settings → Network) likewise
// rebuild, so a disabled tier drops out of the nagg → Primal → relay chain.
// ---------------------------------------------------------------------------

let loggerBridged = false;

/** Route nagg-ts's structured logs into the app logger so the tier trace is visible. */
function bridgeNostrLoggerOnce(): void {
  if (loggerBridged) return;
  loggerBridged = true;
  const bridge: NostrLogger = {
    debug: (event, data) => log.debug(event, data),
    info: (event, data) => log.info(event, data),
    warn: (event, data) => log.warn(event, data),
  };
  setNostrLogger(bridge);
}

type TierConfig = ReturnType<typeof getNostrTierConfig>;

/** Assemble a fresh facade whose tiers reflect the enable/disable toggles. */
function assembleLayer(config: TierConfig): facade.NostrDataLayer | null {
  const tiers: facade.NostrTierStrategy[] = [];

  if (config.nagg.enabled) {
    const client = createNaggClient({
      appView: { baseUrl: config.nagg.appViewBaseUrl, version: 'v1' },
    });
    tiers.push(facade.createNaggTier({ client }));
  }

  if (config.primal.enabled) {
    const connection = facade.primal.createPrimalWebSocketConnection({ url: config.primal.url });
    tiers.push(facade.primal.createPrimalTier({ connection }));
  }

  if (config.relay.enabled) {
    const connection = facade.relay.createRelayPoolConnection({ relays: [...config.relay.relays] });
    tiers.push(facade.relay.createRelayTier({ connection }));
  }

  if (tiers.length === 0) {
    log.warn('nostr.facade.no_tiers_enabled');
    return null;
  }
  return facade.createNostrDataLayer({ tiers });
}

type LayerMemo = {
  layer: facade.NostrDataLayer;
  configKey: string;
  pubkey: string | undefined;
  /** Tears down the profile-cache write-behind subscription on rebuild/switch. */
  teardownPersistence: () => void;
};

let memo: LayerMemo | null = null;

/**
 * Boot-seed the entity cache (the single profile owner) from the persisted
 * mirror at low confidence (seenAt 0), so non-feed surfaces (DMs, contacts,
 * signer) render cached names/avatars instantly on cold start — before any
 * fetch — exactly as the old separate persisted cache did. A real kind-0 from
 * any tier overrides it (higher seenAt wins the merge).
 */
function seedPersistedProfiles(layer: facade.NostrDataLayer): void {
  const byPubkey = useNostrMetadataCache.getState().byPubkey;
  const metadata: Record<string, facade.ProfileMetadata> = {};
  let count = 0;
  for (const [pubkey, entry] of Object.entries(byPubkey)) {
    const { fetchedAt: _fetchedAt, ...rest } = entry;
    metadata[pubkey] = rest;
    count += 1;
  }
  if (count === 0) return;
  layer.cache.ingestProfileMetadata(metadata, 0, 'cache');
  log.debug('nostr.facade.profiles_boot_seeded', { count });
}

/**
 * Mirror the entity cache's profile snapshot to durable storage (write-behind,
 * debounced) so the boot-seed above has data next launch. The entity cache is
 * the single owner; this store is purely its persistent tail. Returns a
 * teardown that cancels the subscription + any pending flush.
 */
function startProfilePersistence(layer: facade.NostrDataLayer): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const records: Record<string, NostrProfileMetadata> = {};
    for (const record of layer.cache.profiles.values()) {
      const mapped = cachedProfileToMetadata(record);
      if (mapped && record.pubkey) records[record.pubkey] = mapped;
    }
    useNostrMetadataCache.getState().persistOwnerSnapshot(records);
  };
  const unsub = layer.cache.profiles.subscribe(() => {
    if (timer) return; // a flush is already scheduled
    timer = setTimeout(flush, WRITE_BEHIND_DEBOUNCE_MS);
  });
  return () => {
    // Flush any debounced write before tearing down (e.g. on profile switch /
    // tier rebuild) so records the cache already observed aren't dropped with
    // the pending timer.
    if (timer) {
      clearTimeout(timer);
      flush();
    }
    unsub();
  };
}

function activeViewerPubkey(): string | undefined {
  return useProfileStore.getState().getActiveProfile()?.pubkey;
}

/**
 * Seed the active profile's cached name/picture (from profileStore) into the
 * entity cache at low confidence ('cache' rank, seenAt 0) so the viewer's own
 * pfp/name render instantly — notably on the notifications screen, whose targets
 * are the viewer's own posts — with zero fetch. A real kind-0 from any tier
 * overrides it. Re-run on every (re)build so it survives an identity switch.
 */
function seedOwnProfile(layer: facade.NostrDataLayer): void {
  const profile = useProfileStore.getState().getActiveProfile();
  if (!profile?.pubkey) return;
  const { cachedDisplayName, cachedPicture } = profile;
  if (!cachedDisplayName && !cachedPicture) return;
  layer.cache.ingestProfileInfos(
    {
      [profile.pubkey]: {
        name: cachedDisplayName ?? '',
        ...(cachedPicture ? { picture: cachedPicture } : {}),
      },
    },
    'cache'
  );
}

/**
 * The profile-scoped Nostr data-layer singleton (see file header). Returns the
 * memoised facade for the active profile + tier config, rebuilding only when the
 * identity or the toggles change. Returns null when every tier is disabled.
 */
export function buildNostrDataLayer(): facade.NostrDataLayer | null {
  bridgeNostrLoggerOnce();
  const config = getNostrTierConfig();
  const configKey = JSON.stringify(config);
  const pubkey = activeViewerPubkey();

  if (memo && memo.configKey === configKey && memo.pubkey === pubkey) return memo.layer;

  // Rebuild (identity switch or tier-toggle change): tear down the prior
  // write-behind, and on an identity switch drop the prior profile's cache.
  if (memo) {
    memo.teardownPersistence();
    if (memo.pubkey !== pubkey) {
      memo.layer.cache.clear();
      log.info('nostr.facade.profile_switch_cleared');
    }
  }

  const layer = assembleLayer(config);
  if (layer) {
    seedOwnProfile(layer);
    seedPersistedProfiles(layer);
    const teardownPersistence = startProfilePersistence(layer);
    memo = { layer, configKey, pubkey, teardownPersistence };
  } else {
    memo = null;
  }
  return layer;
}
