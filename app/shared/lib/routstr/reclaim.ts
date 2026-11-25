import { z } from 'zod';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { isTokenSpent } from '@/shared/lib/cashu/spentProbe';
import { activePubkey, useProfileStore } from '@/shared/stores/global/profileStore';
import { createSdkStorageDriver } from '@/shared/lib/routstr/sdk/driver';
import type { RequestControls } from 'wallet/safeFetch';

type WalletManager = NonNullable<ReturnType<typeof CocoManager.peekInstance>>;
const pendingPaymentSweeps = new WeakMap<WalletManager, Promise<PendingRecoveryOutcome>>();
const legacyBalanceSweeps = new WeakMap<WalletManager, Promise<ReclaimOutcome>>();
const sdkRecordSweeps = new WeakMap<WalletManager, Promise<SdkSweepOutcome>>();

/**
 * Sweep every Routstr credential this profile has held back into the wallet.
 *
 * A Routstr key opens a hosted account on ONE node, and the app has changed
 * node twice without moving the money — so sats are sitting on nodes the user
 * can no longer reach through the UI. `POST /v1/balance/refund` hands them back
 * as a Cashu token, which goes straight into Coco.
 *
 * A credential is sent only to its recorded issuing provider. Trying other
 * providers would disclose bearer authority over that balance. Unknown-owner
 * records stay recoverable until their provider can be established.
 * The endpoint replays its last paid refund, so a lost response can be re-asked.
 */

/** Refund payloads are string-encoded amounts, and the unit field depends on
 *  the key's unit (`sats` for sat-denominated keys, `msats` otherwise). */
const RefundSpine = z.looseObject({
  token: z.string().max(65_536).optional(),
  sats: z.string().max(32).optional(),
  msats: z.string().max(32).optional(),
});

function normalizeIssuerBase(base: string): string {
  return base.trim().replace(/\/+$/, '').replace(/\/v1$/i, '').toLowerCase();
}

function refundUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${trimmed}/v1/balance/refund`;
}

/** Ask one node for one credential's balance. Returns the token when there is
 *  money to collect, `null` when there is definitively nothing here, and
 *  `'retry'` when the answer is not final. */
async function askNode(
  base: string,
  apiKey: string,
  controls: RequestControls
): Promise<string | null | 'retry'> {
  let response: Response;
  try {
    // An arbitrary node base, not the configured one, and the reply is a
    // bearer token rather than an envelope `fetchJson` could validate.
    // eslint-disable-next-line no-restricted-globals -- see the note above
    response = await fetch(refundUrl(base), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
    });
  } catch {
    return 'retry';
  }

  if (!response.ok) {
    apiLog.info('routstr.reclaim.declined', { status: response.status });
    // Only a swept refund is final. In particular, 400 also means ongoing
    // requests and 502 can be a payout still being reconciled by the node.
    return response.status === 410 ? null : 'retry';
  }

  const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.token) {
    // An unfamiliar success body is not evidence that the money was received.
    apiLog.warn('routstr.reclaim.no_token');
    return 'retry';
  }
  return parsed.data.token;
}

/**
 * Chase the change for payments the app never finished collecting.
 *
 * The dangerous window in pay-per-request is between handing a token to a node
 * and reading the change out of its response header. Die there — force quit,
 * crash, OS reclaim — and the header never arrives. routstr closes it: its
 * refund endpoint takes the ORIGINAL token in `X-Cashu` and returns that
 * request's change (`routstr/balance.py`), so a payment recorded before it
 * left can always be asked about again.
 *
 * The four answers are all distinct and all matter:
 *   200 — here is the change. Bank it, forget the row.
 *   404 — this node never saw the token. It was never spent, so undo the send.
 *   425 — the upstream request is still running. Ask again later.
 *   410 — the refund was swept. Nothing to collect; stop asking.
 */
export async function recoverPendingPayments(controls: RequestControls = {}): Promise<number> {
  return (await recoverPendingPaymentsDetailed(controls)).recovered;
}

interface PendingRecoveryOutcome {
  /** Rows whose change (or unspent token) is back in the wallet. */
  recovered: number;
  /** Rows left for the next pass: offline, pending, a failed receive. */
  retryable: number;
  /** Rows whose recorded node is not an address the wallet may ask. */
  unknownIssuer: number;
  /** Rows whose replayed refund the mint reports spent; kept, not dropped. */
  spentReplay: number;
}

/** {@link recoverPendingPayments}, with what became of the rows it kept. */
export async function recoverPendingPaymentsDetailed(
  controls: RequestControls = {}
): Promise<PendingRecoveryOutcome> {
  const manager = CocoManager.peekInstance();
  if (!manager || controls.signal?.aborted)
    return { recovered: 0, retryable: 0, unknownIssuer: 0, spentReplay: 0 };
  const active = pendingPaymentSweeps.get(manager);
  if (active) return active;
  const sweep = recoverPendingPaymentsOnce(manager, controls);
  pendingPaymentSweeps.set(manager, sweep);
  try {
    return await sweep;
  } finally {
    pendingPaymentSweeps.delete(manager);
  }
}

async function recoverPendingPaymentsOnce(
  manager: WalletManager,
  controls: RequestControls
): Promise<PendingRecoveryOutcome> {
  const owner = useProfileStore.getState().activeAccountIndex;
  const ownsScope = () =>
    !controls.signal?.aborted &&
    useProfileStore.getState().activeAccountIndex === owner &&
    CocoManager.peekInstance() === manager;

  const store = useRoutstrStore.getState();
  const pending = Object.entries(store.pendingPayments);
  const outcome: PendingRecoveryOutcome = {
    recovered: 0,
    retryable: 0,
    unknownIssuer: 0,
    spentReplay: 0,
  };
  if (pending.length === 0) return outcome;

  for (const [id, payment] of pending) {
    if (!ownsScope()) break;
    if (!z.httpUrl().safeParse(payment.nodeBaseUrl).success) {
      outcome.unknownIssuer += 1;
      continue;
    }
    let response: Response;
    try {
      // An arbitrary node base, and the reply is a bearer token rather than a
      // validatable envelope.
      // eslint-disable-next-line no-restricted-globals -- see the note above
      response = await fetch(refundUrl(payment.nodeBaseUrl), {
        method: 'POST',
        headers: { 'X-Cashu': payment.encoded, 'Content-Type': 'application/json' },
        body: '{}',
        signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
      });
    } catch {
      outcome.retryable += 1; // offline; the row survives for the next sweep
      continue;
    }
    if (!ownsScope()) break;

    if (response.status === 404) {
      // The node has no record of this token, so it was never redeemed. The
      // proofs are still ours — give them back to the wallet.
      try {
        await manager.ops.send.reclaim(payment.operationId);
        if (!ownsScope()) break;
        useRoutstrStore.getState().settlePayment(id);
        outcome.recovered += 1;
        apiLog.info('routstr.payment.recovered_unspent', { operationId: payment.operationId });
      } catch (error) {
        outcome.retryable += 1;
        apiLog.warn('routstr.payment.recover_reclaim_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    if (response.status === 410) {
      apiLog.warn('routstr.payment.change_swept', { startedAt: payment.startedAt });
      useRoutstrStore.getState().settlePayment(id);
      continue;
    }
    if (!response.ok) {
      outcome.retryable += 1; // 425 and anything else: try again later
      continue;
    }

    const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
    if (!ownsScope()) break;
    if (!parsed.success || !parsed.data.token) {
      outcome.retryable += 1;
      continue;
    }
    // The endpoint replays a refund it has already paid. One the mint has
    // spent is one this wallet banked on an earlier pass, or never will:
    // nothing local proves which, so the row stays and is reported.
    if (await isTokenSpent(manager, parsed.data.token)) {
      outcome.spentReplay += 1;
      continue;
    }
    if (!ownsScope()) break;
    try {
      const prepared = await manager.ops.receive.prepare({ token: parsed.data.token });
      if (!ownsScope()) break;
      await manager.ops.receive.execute(prepared);
      if (!ownsScope()) break;
      useRoutstrStore.getState().settlePayment(id);
      outcome.recovered += 1;
      apiLog.info('routstr.payment.change_recovered', { startedAt: payment.startedAt });
    } catch (error) {
      outcome.retryable += 1;
      // Leave the row: the refund is idempotent, so the next sweep re-asks.
      apiLog.error('routstr.payment.change_receive_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (outcome.recovered > 0) apiLog.info('routstr.payment.recovery_swept', { ...outcome });
  return outcome;
}

interface ReclaimOutcome {
  /** Credentials examined this pass. */
  attempted: number;
  /** Credentials whose balance is now in the wallet. */
  reclaimed: number;
  /** Credentials whose answer was not final; the next pass tries again. */
  deferred: number;
  /** Of `deferred`: credentials with no node address the wallet may ask. */
  unknownIssuer: number;
  /** Of `deferred`: replayed refunds the mint reports spent. */
  spentReplay: number;
}

const EMPTY_RECLAIM: ReclaimOutcome = {
  attempted: 0,
  reclaimed: 0,
  deferred: 0,
  unknownIssuer: 0,
  spentReplay: 0,
};

/**
 * Run one sweep. Safe to call repeatedly — a reclaimed row is skipped, and the
 * refund endpoint is idempotent for the rest.
 *
 * Triggered on app foreground rather than a timer: a suspended mobile process
 * never runs timers, which is why routstrd's 42-minute sweep is the wrong shape
 * here.
 */
export async function reclaimRoutstrBalances(
  controls: RequestControls = {}
): Promise<ReclaimOutcome> {
  const manager = CocoManager.peekInstance();
  if (!manager || controls.signal?.aborted) return { ...EMPTY_RECLAIM };
  // Startup and the manual Reclaim action share one pass over this wallet's
  // credentials. A second snapshot could redeem the same replayed refund.
  const active = legacyBalanceSweeps.get(manager);
  if (active) return active;
  const sweep = reclaimRoutstrBalancesOnce(manager, controls);
  legacyBalanceSweeps.set(manager, sweep);
  try {
    return await sweep;
  } finally {
    legacyBalanceSweeps.delete(manager);
  }
}

async function reclaimRoutstrBalancesOnce(
  manager: WalletManager,
  controls: RequestControls
): Promise<ReclaimOutcome> {
  const owner = useProfileStore.getState().activeAccountIndex;
  const ownsScope = () =>
    !controls.signal?.aborted &&
    useProfileStore.getState().activeAccountIndex === owner &&
    CocoManager.peekInstance() === manager;

  const state = useRoutstrStore.getState();
  const pending = Object.entries(state.legacyAccounts).filter(
    ([, account]) => account.reclaimedAt == null && account.apiKey
  );
  if (pending.length === 0) return { ...EMPTY_RECLAIM };

  const outcome: ReclaimOutcome = { ...EMPTY_RECLAIM, attempted: pending.length };

  for (const [nodeKey, account] of pending) {
    if (!ownsScope()) break;
    const node = account.nodeBaseUrl ?? nodeKey;
    if (!z.httpUrl().safeParse(node).success) {
      outcome.deferred += 1;
      outcome.unknownIssuer += 1;
      continue;
    }

    const result = await askNode(node, account.apiKey, controls);
    if (!ownsScope()) break;
    if (result === 'retry') {
      outcome.deferred += 1;
      continue;
    }
    if (result === null) {
      // The issuing node reports a terminal result. Retain the credential.
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
      continue;
    }
    // The endpoint replays its last paid refund, so this may be one the
    // wallet already banked. Left deferred, as any other unfinished answer.
    if (await isTokenSpent(manager, result)) {
      outcome.deferred += 1;
      outcome.spentReplay += 1;
      continue;
    }
    if (!ownsScope()) break;
    try {
      const prepared = await manager.ops.receive.prepare({ token: result });
      if (!ownsScope()) break;
      await manager.ops.receive.execute(prepared);
      if (!ownsScope()) break;
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
      outcome.reclaimed += 1;
      apiLog.info('routstr.reclaim.collected', { node });
    } catch {
      // The provider can replay the refund on the next pass.
      apiLog.error('routstr.reclaim.receive_failed');
      outcome.deferred += 1;
    }
  }

  apiLog.info('routstr.reclaim.swept', { ...outcome });
  return outcome;
}

// ---------------------------------------------------------------------------
// Records the removed Routstr SDK left behind (0.1.4, E20)
//
// `@routstr/sdk` kept four kinds of money-bearing record in this profile's
// vaults (sdk/driver.ts). Nothing reads them since the AI tab went, so each is
// swept here under the same rule as the store's own rows: a record is only
// ever sent to the node that issued it, and a row is only removed once its
// money is in the wallet or its node gave a final answer.
// ---------------------------------------------------------------------------

/** Shapes as @routstr/sdk 0.4.6 persists them (`SdkStorageState`). Unknown
 *  fields are kept: a row is filtered out of the original array, never rebuilt. */
const SdkApiKeys = z.array(z.looseObject({ baseUrl: z.string(), key: z.string() }));
const SdkChildKeys = z.array(z.looseObject({ parentBaseUrl: z.string(), childKey: z.string() }));
const SdkXcashuTokens = z.record(
  z.string(),
  z.array(z.looseObject({ baseUrl: z.string().optional(), token: z.string() }))
);
const SdkCachedReceiveTokens = z.array(z.looseObject({ token: z.string() }));

interface SdkRecoveryRecords {
  apiKeys: z.infer<typeof SdkApiKeys>;
  childKeys: z.infer<typeof SdkChildKeys>;
  xcashuTokens: z.infer<typeof SdkXcashuTokens>;
  cachedReceiveTokens: z.infer<typeof SdkCachedReceiveTokens>;
  /** Records that could not be read; kept untouched and counted as retryable. */
  unreadable: number;
}

type SdkDriver = ReturnType<typeof createSdkStorageDriver>;

async function readSdkRecord<T>(
  driver: SdkDriver,
  key: string,
  schema: z.ZodType<T>,
  empty: T
): Promise<T | null> {
  try {
    const raw = await driver.getItem<unknown>(key, empty);
    if (raw == null) return empty;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Read every SDK recovery record the account holds. Never throws. */
export async function readSdkRecoveryRecords(owner: string): Promise<SdkRecoveryRecords> {
  const driver = createSdkStorageDriver(owner);
  let unreadable = 0;
  const read = async <T>(key: string, schema: z.ZodType<T>, empty: T): Promise<T> => {
    const value = await readSdkRecord(driver, key, schema, empty);
    if (value === null) unreadable += 1;
    return value ?? empty;
  };
  const apiKeys = await read('api_keys', SdkApiKeys, []);
  const childKeys = await read('child_keys', SdkChildKeys, []);
  const xcashuTokens = await read('xcashu_tokens', SdkXcashuTokens, {});
  const cachedReceiveTokens = await read('cached_receive_tokens', SdkCachedReceiveTokens, []);
  return { apiKeys, childKeys, xcashuTokens, cachedReceiveTokens, unreadable };
}

const isHttpUrl = (url: string | undefined): url is string =>
  !!url && z.httpUrl().safeParse(url).success;
const sameNode = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Child keys spend their parent's balance: the parent is the one to sweep. */
function childKeyHasParent(records: SdkRecoveryRecords, parentBaseUrl: string): boolean {
  return records.apiKeys.some((k) => sameNode(k.baseUrl, parentBaseUrl));
}

/** How many unresolved SDK rows there are, and how many of those have no
 *  issuing node this wallet may ask. */
export function countSdkRecords(records: SdkRecoveryRecords): {
  total: number;
  unknownIssuer: number;
} {
  const xcashu = Object.entries(records.xcashuTokens).flatMap(([node, rows]) =>
    rows.map((row) => row.baseUrl ?? node)
  );
  const unknownIssuer =
    records.apiKeys.filter((k) => !isHttpUrl(k.baseUrl)).length +
    xcashu.filter((node) => !isHttpUrl(node)).length +
    records.childKeys.filter((c) => !childKeyHasParent(records, c.parentBaseUrl)).length;
  return {
    total:
      records.apiKeys.length +
      records.childKeys.length +
      xcashu.length +
      records.cachedReceiveTokens.length +
      records.unreadable,
    unknownIssuer,
  };
}

interface SdkSweepOutcome {
  /** Rows whose money is now in the wallet. */
  collected: number;
  /** Rows whose answer was not final (offline, pending, a failed receive). */
  retryable: number;
  /** Rows with no issuing node to ask; kept. */
  unknownIssuer: number;
  /** Rows whose token the mint reports spent with no local proof that this
   *  wallet banked it; kept so they stay visible. */
  spentReplay: number;
}

const EMPTY_SDK_SWEEP: SdkSweepOutcome = {
  collected: 0,
  retryable: 0,
  unknownIssuer: 0,
  spentReplay: 0,
};

/** Sweep the SDK's recovery records into the wallet. Shares one pass per
 *  wallet, like the other sweeps, and stops when `controls.signal` aborts, the
 *  account changes or the wallet is replaced. */
export async function recoverSdkRecords(controls: RequestControls = {}): Promise<SdkSweepOutcome> {
  const manager = CocoManager.peekInstance();
  const owner = activePubkey();
  if (!manager || !owner || controls.signal?.aborted) return { ...EMPTY_SDK_SWEEP };
  const active = sdkRecordSweeps.get(manager);
  if (active) return active;
  const sweep = recoverSdkRecordsOnce(manager, owner, controls);
  sdkRecordSweeps.set(manager, sweep);
  try {
    return await sweep;
  } finally {
    sdkRecordSweeps.delete(manager);
  }
}

async function recoverSdkRecordsOnce(
  manager: WalletManager,
  owner: string,
  controls: RequestControls
): Promise<SdkSweepOutcome> {
  const ownsScope = () =>
    !controls.signal?.aborted && activePubkey() === owner && CocoManager.peekInstance() === manager;
  const outcome: SdkSweepOutcome = { ...EMPTY_SDK_SWEEP };
  const records = await readSdkRecoveryRecords(owner);
  outcome.retryable += records.unreadable;
  if (!ownsScope()) return outcome;
  const driver = createSdkStorageDriver(owner);
  const save = async (key: string, value: unknown) => {
    await driver.setItem(key, value);
    await driver.flush();
  };

  /** Bank one token. `'spent'` when the mint already redeemed it. */
  const bank = async (token: string): Promise<'banked' | 'spent' | 'failed' | 'aborted'> => {
    if (await isTokenSpent(manager, token)) return 'spent';
    if (!ownsScope()) return 'aborted';
    try {
      const prepared = await manager.ops.receive.prepare({ token });
      if (!ownsScope()) return 'aborted';
      await manager.ops.receive.execute(prepared);
      return 'banked';
    } catch {
      apiLog.error('routstr.sdk_recovery.receive_failed');
      return 'failed';
    }
  };
  const tally = (result: 'banked' | 'spent' | 'failed' | 'aborted'): boolean => {
    if (result === 'banked') outcome.collected += 1;
    else if (result === 'spent') outcome.spentReplay += 1;
    else outcome.retryable += 1;
    return result === 'banked';
  };

  try {
    // Change the SDK received but never managed to bank.
    let cached = records.cachedReceiveTokens;
    for (const row of records.cachedReceiveTokens) {
      if (!ownsScope()) return outcome;
      if (!tally(await bank(row.token))) continue;
      cached = cached.filter((r) => r !== row);
      await save('cached_receive_tokens', cached);
    }

    // Request tokens a node holds: ask that node for the change, as
    // recoverPendingPayments does for the store's own rows.
    let xcashu = records.xcashuTokens;
    for (const [nodeKey, rows] of Object.entries(records.xcashuTokens)) {
      for (const row of rows) {
        if (!ownsScope()) return outcome;
        const node = row.baseUrl ?? nodeKey;
        if (!isHttpUrl(node)) {
          outcome.unknownIssuer += 1;
          continue;
        }
        const answer = await askForChange(node, row.token, controls);
        if (!ownsScope()) return outcome;
        let settled = false;
        if (answer.kind === 'swept') settled = true;
        else if (answer.kind === 'retry') outcome.retryable += 1;
        // 404: the node never redeemed it, so the original token is still ours.
        else settled = tally(await bank(answer.kind === 'unseen' ? row.token : answer.token));
        if (!settled) continue;
        xcashu = {
          ...xcashu,
          [nodeKey]: (xcashu[nodeKey] ?? []).filter((r) => r !== row),
        };
        if (xcashu[nodeKey].length === 0) {
          const { [nodeKey]: _gone, ...rest } = xcashu;
          xcashu = rest;
        }
        await save('xcashu_tokens', xcashu);
      }
    }

    // Hosted balances. A key the store's legacy sweep already banked on the
    // SAME issuing node is settled by that evidence; one it still holds is left
    // to that sweep. Matching both bearer key and normalized issuing URL ensures
    // identical keys on distinct nodes never suppress or erase each other.
    const legacyEntries = Object.entries(useRoutstrStore.getState().legacyAccounts);
    const hadParent = (c: { parentBaseUrl: string }) => childKeyHasParent(records, c.parentBaseUrl);
    let apiKeys = records.apiKeys;
    let childKeys = records.childKeys;
    for (const row of records.apiKeys) {
      if (!ownsScope()) return outcome;
      const rowBase = isHttpUrl(row.baseUrl) ? normalizeIssuerBase(row.baseUrl) : null;
      const twinEntry = rowBase
        ? legacyEntries.find(([nodeKey, account]) => {
            if (account.apiKey !== row.key) return false;
            const legacyBase = account.nodeBaseUrl ?? nodeKey;
            return isHttpUrl(legacyBase) && normalizeIssuerBase(legacyBase) === rowBase;
          })
        : undefined;
      const twin = twinEntry?.[1];
      let settled = false;
      if (twin?.reclaimedAt != null) settled = true;
      else if (twin) outcome.retryable += 1;
      else if (!rowBase) outcome.unknownIssuer += 1;
      else {
        const result = await askNode(row.baseUrl, row.key, controls);
        if (!ownsScope()) return outcome;
        if (result === null) settled = true;
        else if (result === 'retry') outcome.retryable += 1;
        else settled = tally(await bank(result));
      }
      if (!settled) continue;
      const nextApiKeys = apiKeys.filter((r) => r !== row);
      // Persist dependent child-key cleanup BEFORE removing the settled parent
      // so an interruption between the two writes never orphans child keys as
      // unknown-issuer records on the next launch.
      const nextChildKeys = childKeys.filter(
        (c) =>
          !hadParent(c) || childKeyHasParent({ ...records, apiKeys: nextApiKeys }, c.parentBaseUrl)
      );
      if (nextChildKeys.length !== childKeys.length) {
        if (!ownsScope()) return outcome;
        await save('child_keys', nextChildKeys);
        childKeys = nextChildKeys;
      }
      if (!ownsScope()) return outcome;
      await save('api_keys', nextApiKeys);
      apiKeys = nextApiKeys;
    }

    // Child keys hold no balance of their own; ones without any recorded parent
    // have no node to ask and stay visible as unknown-issuer.
    outcome.unknownIssuer += records.childKeys.filter((c) => !hadParent(c)).length;
  } catch (error) {
    // A row whose removal could not be saved is re-read next pass; the spent
    // probe then keeps it from being banked twice.
    apiLog.warn('routstr.sdk_recovery.save_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    outcome.retryable += 1;
  }

  apiLog.info('routstr.sdk_recovery.swept', { ...outcome });
  return outcome;
}

type ChangeAnswer =
  { kind: 'token'; token: string } | { kind: 'unseen' } | { kind: 'swept' } | { kind: 'retry' };

/** Ask a node for the change on a token it was paid, by the token itself. */
async function askForChange(
  base: string,
  encoded: string,
  controls: RequestControls
): Promise<ChangeAnswer> {
  let response: Response;
  try {
    // eslint-disable-next-line no-restricted-globals -- an arbitrary node base; see askNode
    response = await fetch(refundUrl(base), {
      method: 'POST',
      headers: { 'X-Cashu': encoded, 'Content-Type': 'application/json' },
      body: '{}',
      signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
    });
  } catch {
    return { kind: 'retry' };
  }
  if (response.status === 404) return { kind: 'unseen' };
  if (response.status === 410) return { kind: 'swept' };
  if (!response.ok) return { kind: 'retry' };
  const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
  return parsed.success && parsed.data.token
    ? { kind: 'token', token: parsed.data.token }
    : { kind: 'retry' };
}
