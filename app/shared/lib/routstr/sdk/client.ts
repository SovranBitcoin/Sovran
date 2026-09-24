// `@routstr/sdk/browser`, not `/client` or `/storage`: those entries reach for
// `os` and `better-sqlite3` to persist Tinfoil's cache secret and its model
// database on a filesystem. React Native has neither. The browser build carries
// the same client and store factories without them.
import {
  RoutstrClient,
  createDiscoveryAdapterFromStore,
  createSdkStore,
  createStorageAdapterFromStore,
  type DiscoveryAdapter,
  type Model,
} from '@routstr/sdk/browser';

import { apiLog } from '@/shared/lib/logger';

import { sdkStorageDriver } from './driver';

/**
 * The single `RoutstrClient` for this profile.
 *
 * Built lazily and once: the SDK's store hydrates from disk, and its provider
 * manager tracks failures across requests, so handing out fresh clients would
 * throw that away every send and re-fetch the same catalogs.
 *
 * Mode is `xcashu` — pay per request, change back in the response header. The
 * alternative, `apikeys`, is the hosted-account model that stranded balances on
 * nodes the app had moved away from.
 */

interface Built {
  client: RoutstrClient;
  discovery: DiscoveryAdapter;
}

let built: Promise<Built> | null = null;

/** The SDK keys every provider cache by a trailing-slash URL, but its setters
 *  store what they are given. Seeding has to match the lookup or the catalog
 *  is invisible — and an invisible catalog prices every request at 1 sat,
 *  which the node's admission gate refuses. */
const providerKey = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

/**
 * The wallet adapter, reached lazily.
 *
 * A static import would pull the Coco manager — and the whole wallet graph
 * behind it — into every module that touches Routstr, including tests that have
 * no business booting a wallet. Same reasoning, and the same `require` form, as
 * the lazy store access in `api.ts`: Metro handles both spellings, Jest's CJS
 * VM only executes this one.
 */
function walletAdapter() {
  const { cocoWalletAdapter } = require('./walletAdapter') as typeof import('./walletAdapter');
  return cocoWalletAdapter;
}

async function build(): Promise<Built> {
  const { store, hydrate } = createSdkStore({ driver: sdkStorageDriver });
  await hydrate;
  const storageAdapter = createStorageAdapterFromStore(store);
  const discovery = createDiscoveryAdapterFromStore(store);
  apiLog.info('routstr.sdk.client_ready');
  return {
    discovery,
    client: new RoutstrClient(
      walletAdapter(),
      storageAdapter,
      discovery,
      // `min` keeps the SDK's own user-facing alerting out of the way: this app
      // routes every failure through its own error catalog, and two voices
      // describing one failure is worse than either alone.
      'min',
      'xcashu'
    ),
  };
}

function ensure(): Promise<Built> {
  built ??= build().catch((error) => {
    // Never cache a failed build: a transient storage error at boot would
    // otherwise disable AI for the whole session.
    built = null;
    throw error;
  });
  return built;
}

export async function getRoutstrClient(): Promise<RoutstrClient> {
  return (await ensure()).client;
}

/**
 * Teach the SDK this node's catalog, from the lineup the app already fetched.
 *
 * The SDK sizes the token it attaches to a request from its own cached model
 * pricing, and would otherwise have to discover the catalog over Nostr with its
 * own relay pool — a second discovery stack next to nagg's, answering the same
 * question. Sovran's lineup stays the source of truth; this hands the SDK the
 * pricing it needs to clear the node's admission gate.
 *
 * `mints` is the node's accepted mint list. With it the SDK can pay from
 * another mint the user already holds when the selected one is not accepted,
 * instead of minting a token the node will refuse.
 */
export async function seedProviderCatalog(
  baseUrl: string,
  models: Model[],
  mints?: string[]
): Promise<void> {
  const { discovery } = await ensure();
  const key = providerKey(baseUrl);
  discovery.setCachedModels({ ...discovery.getCachedModels(), [key]: models });
  if (mints?.length) {
    discovery.setCachedMints({
      ...discovery.getCachedMints(),
      [key]: await inWalletSpelling(mints),
    });
  }
  discovery.setProviderLastUpdate(baseUrl, Date.now());
  apiLog.info('routstr.sdk.catalog_seeded', { models: models.length, mints: mints?.length ?? 0 });
}

const canonicalMint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Re-spell the node's accepted mints the way the wallet spells them.
 *
 * The SDK matches an accepted mint against a wallet mint with `includes`, on
 * the raw string. Nodes and wallets disagree about trailing slashes and case —
 * `https://ecashmint.otrta.me/` against `https://ecashmint.otrta.me` — and an
 * exact-match miss reads as "you do not hold a mint this provider accepts",
 * which silently sends the payment from a mint the provider will refuse.
 */
async function inWalletSpelling(mints: string[]): Promise<string[]> {
  let held: string[] = [];
  try {
    held = Object.keys(await walletAdapter().getBalances());
  } catch {
    // Wallet not ready. The node's own spelling is still better than nothing:
    // it is right whenever the two already agree.
    return mints;
  }
  const byCanonical = new Map(held.map((url) => [canonicalMint(url), url]));
  return mints.map((mint) => byCanonical.get(canonicalMint(mint)) ?? mint);
}

/**
 * The mints this provider accepts, as the wallet spells them — or `null` when
 * the node does not publish a list, which means it accepts anything.
 */
export async function acceptedMintsForProvider(baseUrl: string): Promise<string[] | null> {
  const { discovery } = await ensure();
  const mints = discovery.getCachedMints()[providerKey(baseUrl)];
  return mints?.length ? mints : null;
}

/**
 * Chase every request payment the node has not yet accounted for.
 *
 * The SDK records each `X-Cashu` token before it leaves and clears it when the
 * change comes home, so anything still recorded is money in flight — the app
 * was killed mid-request, or the response never arrived. The sweep asks each
 * node's refund endpoint, and falls back to redeeming the original token when
 * the node never took it. Safe to call repeatedly; it is the question a local
 * reclaim cannot answer.
 */
export async function sweepUnsettledPayments(mintUrl: string): Promise<void> {
  try {
    const { client } = await ensure();
    const results = await client.getCashuSpender().refundXcashuTokens(mintUrl);
    const recovered = results.filter((r) => r.success).length;
    if (results.length) {
      apiLog.info('routstr.sdk.sweep', { attempted: results.length, recovered });
    }
  } catch (error) {
    apiLog.warn('routstr.sdk.sweep_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Drop the client so the next call rebuilds it. Used on profile switch, where
 *  the store, the wallet and the provider list all belong to someone else. */
export function resetRoutstrClient(): void {
  built = null;
}
