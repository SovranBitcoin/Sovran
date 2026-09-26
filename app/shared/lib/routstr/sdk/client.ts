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
import { captureProfileStorageOwner } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { routstrMintKey } from '../payingMint';

import { createSdkStorageDriver } from './driver';
import { createSdkLogger, type SdkRefusal } from './sdkLogger';

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
  // How far the money got, for the caller's attempt timeline. A failed request
  // that never reached `sendToken` and one that paid and got nothing back are
  // different bugs with the same error, and only this tells them apart.
  let mintedSats: number | null = null;
  let mintedFromHost: string | undefined;
  let changeSats: number | null = null;
  // The last non-OK answer the node gave THIS request, as the SDK logged it.
  // `FailoverError` carries none of it, and the candidate walk needs the
  // status and the node's `type`/`code` to tell "this model's upstream is
  // gone" from "this node is broken".
  let lastRefusal: SdkRefusal | null = null;
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
        mintedFromHost = hostOf(mintUrl);
        const token = await wallet.sendToken(mintUrl, amount);
        originalToken = token;
        received = false;
        mintedSats = amount;
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
          if (result.success) changeSats = result.amount;
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
    // WARN and ERROR only — see `createSdkLogger`. The SDK's DEBUG lane prints
    // raw refund bodies and whole tokens and stays dropped; its warnings carry
    // the upstream status and failover decision, which is the one account of a
    // provider failure the app cannot reconstruct for itself.
    {
      logger: createSdkLogger(undefined, '', (refusal) => {
        lastRefusal = refusal;
      }),
    }
  );
  return {
    client,
    baseUrl: key,
    /** The node's last refusal of this request, or `null` if it never refused. */
    refusal() {
      return lastRefusal;
    },
    /**
     * Forget the request token: the node consumed all of it.
     *
     * The SDK clears a token only when change comes home, and a node sends
     * change only when there is some. A 1-sat token against a sub-sat turn
     * rounds to a cost of 1 sat and no `X-Cashu` header — the request settled
     * in full, and the SDK went on treating it as money in flight. Every
     * launch then asked the node to refund it, and the node, holding a payment
     * row with no change row, answered 425 "pending" forever. Fourteen such
     * tokens were being chased on every sweep in the 2026-09-26 log, 78 sats
     * of "stranded" money none of which was owed.
     */
    settleWithoutChange() {
      if (originalToken == null) return;
      built.storage.removeXcashuToken(key, originalToken);
      received = true;
    },
    /**
     * A snapshot of this request's money, for logging only.
     *
     * `mintedSats === null` means the token was never created, which is the
     * one fact that separates "the provider refused us" from "we never got as
     * far as paying" — and the app used to report both as the same failure.
     */
    payment() {
      return {
        mintedSats,
        mintedFromHost,
        changeSats,
        changeReceived: received,
        changeFailed: receiveFailed,
      };
    },
    async finish() {
      await built.driver.flush();
      if (receiveFailed) throw new Error('Payment change is awaiting recovery');
    },
  };
}

/** The host of a URL, without leaning on React Native's partial `URL`. */
function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z]+:\/\/([^/?#]+)/i.exec(value)?.[1];
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
 * How long to wait between refund attempts, and how much waiting one sweep may
 * do in total. routstr-core answers a pending refund with `Retry-After: 2`;
 * these are that advice, once and then once more, bounded so a wallet with
 * several stuck tokens does not spend a minute in the background.
 */
const REFUND_RETRY_DELAYS_MS = [2_000, 4_000];
const REFUND_RETRY_BUDGET_MS = 12_000;

/**
 * Tokens a node has called "pending" already this session.
 *
 * A 425 means the node holds the payment and has not written its change row.
 * That changes when the node's upstream call ends — minutes, or never, if the
 * node's process died mid-request — and not because this app asked again
 * thirty seconds later. The sweep runs on every failed send, so without this
 * one stuck token cost every later failure a refund round-trip and two
 * waits; the log shows the same fourteen tokens asked three times in eight
 * minutes. Each is asked once per session, and again on the next launch.
 */
const pendingThisSession = new Set<string>();

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
    const { tokenAmountSats } = require('./walletAdapter') as typeof import('./walletAdapter');
    let attempted = 0;
    let recovered = 0;
    let recoveredSats = 0;
    let pending = 0;
    let strandedSats = 0;
    // Shared across the whole sweep, not per token: the app calls this the
    // moment a request fails, and eight tokens each waiting out their own
    // backoff would keep the wallet busy for a minute after the user has
    // already moved on.
    let retryBudgetMs = REFUND_RETRY_BUDGET_MS;

    for (const [node, tokens] of Object.entries(built.storage.getXcashuTokens())) {
      assertOwner();
      const bound = await getRoutstrClient(node);
      const host = hostOf(node);
      for (const { token } of tokens) {
        assertOwner();
        const sats = tokenAmountSats(token) ?? undefined;
        if (pendingThisSession.has(token)) {
          pending += 1;
          if (sats != null) strandedSats += sats;
          continue;
        }
        attempted += 1;
        let attempts = 0;
        let refund = await bound.client.getBalanceManager().fetchRefundToken(node, token, true);
        attempts += 1;
        assertOwner();

        // 425 is routstr-core saying the node took the token, has not finished
        // its upstream call, and has not written the refund row yet — it even
        // sends `Retry-After: 2`. Asking once and waiting for the next app
        // launch is how `attempted: 8, recovered: 0` stayed true for hours
        // across 121 refusals: every sweep arrived during the same race and
        // then gave up. The delays honour the node's own advice.
        for (const delay of REFUND_RETRY_DELAYS_MS) {
          if (refund.status !== 425 || retryBudgetMs < delay) break;
          retryBudgetMs -= delay;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          assertOwner();
          refund = await bound.client.getBalanceManager().fetchRefundToken(node, token, true);
          attempts += 1;
          assertOwner();
        }

        // No SDK retry timer and no age/retry-count eviction. A 404 may be
        // recovered directly from the mint, which remains the spend authority.
        const returned =
          refund.success && refund.token ? refund.token : refund.status === 404 ? token : null;
        if (!returned) {
          if (refund.status === 425) {
            pending += 1;
            pendingThisSession.add(token);
          }
          if (sats != null) strandedSats += sats;
          apiLog.warn('routstr.sweep.token', {
            host,
            sats,
            attempts,
            status: refund.status ?? 0,
            outcome: refund.status === 425 ? 'pending' : 'refused',
            reason: refund.error?.slice(0, 118),
            errorType: refund.parsedError?.type,
          });
          continue;
        }
        const result = await wallet.receiveToken(returned);
        assertOwner();
        if (!result.success) {
          if (sats != null) strandedSats += sats;
          apiLog.warn('routstr.sweep.token', {
            host,
            sats,
            attempts,
            status: refund.status ?? 200,
            // The node handed back a token the mint will not honour. Either it
            // was already banked and the removal did not stick, or the node
            // reissued change it had itself spent — the two cases that cost
            // real sats, and the only place to tell them apart.
            outcome: 'unredeemable',
            reason: result.message?.slice(0, 118),
            fromRefund: refund.success,
          });
          continue;
        }
        built.storage.removeXcashuToken(node, token);
        await built.driver.flush();
        recovered += 1;
        recoveredSats += result.amount;
        apiLog.info('routstr.sweep.token', {
          host,
          sats,
          attempts,
          status: refund.status ?? 200,
          outcome: 'recovered',
          recoveredSats: result.amount,
          fromRefund: refund.success,
        });
      }
    }
    if (attempted || pending) {
      apiLog.info('routstr.sdk.sweep', {
        attempted,
        recovered,
        recoveredSats,
        pending,
        strandedSats,
      });
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
  pendingThisSession.clear();
}
