// `@routstr/sdk/browser`, not `/client` or `/storage`: those entries reach for
// `os` and `better-sqlite3` to persist Tinfoil's cache secret and its model
// database on a filesystem. React Native has neither. The browser build carries
// the same client and store factories without them.
import {
  RoutstrClient,
  createDiscoveryAdapterFromStore,
  createSdkStore,
  createStorageAdapterFromStore,
  noopLogger,
  type DiscoveryAdapter,
  type Model,
} from '@routstr/sdk/browser';

import { apiLog } from '@/shared/lib/logger';
import { captureProfileStorageOwner } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { routstrMintKey } from '../payingMint';

import { createSdkStorageDriver } from './driver';

/**
 * Profile-owned catalog and recovery storage, with a node-bound request client.
 *
 * Hydrate once per profile. Each request gets a fixed provider view and its
 * own settlement result, so neither a provider switch nor another request's
 * failed refund can change the meaning of an in-flight payment.
 *
 * Mode is `xcashu` — pay per request, change back in the response header. The
 * alternative, `apikeys`, is the hosted-account model that stranded balances on
 * nodes the app had moved away from.
 */

interface Built {
  owner: string;
  storage: ReturnType<typeof createStorageAdapterFromStore>;
  driver: ReturnType<typeof createSdkStorageDriver>;
  discovery: DiscoveryAdapter;
}

let built: Promise<Built> | null = null;
let builtOwner: string | null = null;

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
function walletAdapter(assertOwner: () => void = () => {}) {
  const { createCocoWalletAdapter } =
    require('./walletAdapter') as typeof import('./walletAdapter');
  return createCocoWalletAdapter(assertOwner);
}

async function build(owner: string): Promise<Built> {
  const driver = createSdkStorageDriver(owner);
  const { store, hydrate } = createSdkStore({ driver });
  await hydrate;
  const storageAdapter = createStorageAdapterFromStore(store);
  const discovery = createDiscoveryAdapterFromStore(store);
  apiLog.info('routstr.sdk.client_ready');
  return {
    owner,
    storage: storageAdapter,
    driver,
    discovery,
  };
}

async function ensure(): Promise<Built> {
  const owner = await captureProfileStorageOwner();
  if (builtOwner !== owner) {
    built = null;
    builtOwner = owner;
  }
  built ??= build(owner).catch((error) => {
    // Never cache a failed build: a transient storage error at boot would
    // otherwise disable AI for the whole session.
    if (builtOwner === owner) built = null;
    throw error;
  });
  return built;
}

export async function getRoutstrClient(baseUrl: string, canDispatch: () => boolean = () => true) {
  const built = await ensure();
  const key = providerKey(baseUrl);
  const assertOwner = () => {
    const profile = useProfileStore.getState();
    if (
      profile.profiles.find((p) => p.accountIndex === profile.activeAccountIndex)?.pubkey !==
      built.owner
    ) {
      throw new Error('Payment belongs to another profile');
    }
  };
  const assertDispatch = () => {
    assertOwner();
    if (!canDispatch()) throw new Error('Payment request was cancelled');
  };
  const wallet = walletAdapter(assertOwner);
  let receiveFailed = false;
  let originalToken: string | null = null;
  let received = false;
  const storage = {
    ...built.storage,
    removeXcashuToken(node: string, token: string) {
      if (node === key && token === originalToken && received) {
        built.storage.removeXcashuToken(node, token);
      }
    },
    clearXcashuTokensForBaseUrl(node: string) {
      if (node === key && originalToken && received) {
        built.storage.removeXcashuToken(node, originalToken);
      }
    },
    addXcashuToken(node: string, token: string) {
      if (!built.storage.getXcashuTokensForBaseUrl(node).some((entry) => entry.token === token)) {
        built.storage.addXcashuToken(node, token);
      }
    },
  };
  const client = new RoutstrClient(
    {
      ...wallet,
      async sendToken(mintUrl, amount) {
        assertDispatch();
        await built.driver.flush();
        const token = await wallet.sendToken(mintUrl, amount);
        originalToken = token;
        received = false;
        storage.addXcashuToken(key, token);
        await built.driver.flush();
        assertDispatch();
        return token;
      },
      async receiveToken(token) {
        received = false;
        try {
          const result = await wallet.receiveToken(token);
          received = result.success;
          if (!result.success) receiveFailed = true;
          return result;
        } catch (error) {
          // The SDK converts adapter throws into failed receipts. Preserve
          // that outcome for finish even when its finalize promise resolves.
          receiveFailed = true;
          throw error;
        }
      },
    },
    storage,
    {
      ...built.discovery,
      getCachedModels: () => {
        const models = built.discovery.getCachedModels()[key];
        return models ? { [key]: models } : {};
      },
    },
    'min',
    'xcashu',
    // SDK diagnostics include raw refund bodies and token-bearing messages.
    // Sovran emits structured request/recovery events at its own boundaries.
    { logger: noopLogger }
  );
  return {
    client,
    baseUrl: key,
    async finish() {
      await built.driver.flush();
      if (receiveFailed) throw new Error('Payment change is awaiting recovery');
    },
  };
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
  if (mints !== undefined) {
    discovery.setCachedMints({
      ...discovery.getCachedMints(),
      [key]: await inWalletSpelling(mints),
    });
  }
  discovery.setProviderLastUpdate(baseUrl, Date.now());
  apiLog.info('routstr.sdk.catalog_seeded', { models: models.length, mints: mints?.length ?? 0 });
}

const canonicalMint = (url: string) => routstrMintKey(url) ?? url;

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
export async function sweepUnsettledPayments(): Promise<void> {
  try {
    const built = await ensure();
    const assertOwner = () => {
      const profile = useProfileStore.getState();
      if (
        profile.profiles.find((p) => p.accountIndex === profile.activeAccountIndex)?.pubkey !==
        built.owner
      ) {
        throw new Error('Payment belongs to another profile');
      }
    };
    const wallet = walletAdapter(assertOwner);
    let attempted = 0;
    let recovered = 0;
    for (const [node, tokens] of Object.entries(built.storage.getXcashuTokens())) {
      assertOwner();
      const bound = await getRoutstrClient(node);
      for (const { token } of tokens) {
        assertOwner();
        attempted += 1;
        const refund = await bound.client.getBalanceManager().fetchRefundToken(node, token, true);
        assertOwner();
        // No SDK retry timer and no age/retry-count eviction. A 404 may be
        // recovered directly from the mint, which remains the spend authority.
        const returned =
          refund.success && refund.token ? refund.token : refund.status === 404 ? token : null;
        if (!returned) continue;
        const result = await wallet.receiveToken(returned);
        assertOwner();
        if (!result.success) continue;
        built.storage.removeXcashuToken(node, token);
        await built.driver.flush();
        recovered += 1;
      }
    }
    if (attempted) {
      apiLog.info('routstr.sdk.sweep', { attempted, recovered });
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
  builtOwner = null;
}
