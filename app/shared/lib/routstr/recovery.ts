import { z } from 'zod';

import {
  countSdkRecords,
  readSdkRecoveryRecords,
  reclaimRoutstrBalances,
  recoverPendingPaymentsDetailed,
  recoverSdkRecords,
} from '@/shared/lib/routstr/reclaim';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { RequestControls } from 'wallet/safeFetch';

/**
 * Everything Routstr money this account still has outside the wallet: the
 * store's unfinished payments and archived credentials, and the records the
 * removed SDK left in the account's vaults. Counts only — no secret leaves.
 */
interface RoutstrRecoverySnapshot {
  /** Rows any sweep could still act on. */
  total: number;
  /** Of `total`: rows with no node address the wallet may ask. */
  unknownIssuer: number;
}

const isHttpUrl = (url: string | undefined) => !!url && z.httpUrl().safeParse(url).success;

/** What the store alone holds, readable synchronously for a selector. */
export function storeRecoveryCounts(
  state: Pick<ReturnType<typeof useRoutstrStore.getState>, 'pendingPayments' | 'legacyAccounts'>
): RoutstrRecoverySnapshot {
  const pending = Object.values(state.pendingPayments);
  const legacy = Object.entries(state.legacyAccounts).filter(
    ([, account]) => account.reclaimedAt == null && Boolean(account.apiKey)
  );
  return {
    total: pending.length + legacy.length,
    unknownIssuer:
      pending.filter((p) => !isHttpUrl(p.nodeBaseUrl)).length +
      legacy.filter(([key, account]) => !isHttpUrl(account.nodeBaseUrl ?? key)).length,
  };
}

/** What the removed SDK left in this account's vaults. Never throws. */
export async function readSdkRecoveryCounts(owner: string): Promise<RoutstrRecoverySnapshot> {
  return countSdkRecords(await readSdkRecoveryRecords(owner));
}

/** The account's full recovery snapshot, store and SDK records. Never throws. */
export async function readRoutstrRecoverySnapshot(owner: string): Promise<RoutstrRecoverySnapshot> {
  const store = storeRecoveryCounts(useRoutstrStore.getState());
  const sdk = await readSdkRecoveryCounts(owner);
  return {
    total: store.total + sdk.total,
    unknownIssuer: store.unknownIssuer + sdk.unknownIssuer,
  };
}

interface RoutstrRecoveryReport {
  collected: number;
  /** Offline, pending or a failed receive: the next pass asks again. */
  retryable: number;
  unknownIssuer: number;
  /** Replayed refunds the mint reports spent, kept with no local proof of credit. */
  spentReplay: number;
}

/**
 * One full pass, in order: archived credentials, unfinished payments, then the
 * SDK's records — last, because a key the first pass banked settles its SDK
 * twin without asking the node again. Each step honours `controls.signal`.
 */
export async function collectRoutstrLeftovers(
  controls: RequestControls = {}
): Promise<RoutstrRecoveryReport> {
  const legacy = await reclaimRoutstrBalances(controls);
  const pending = await recoverPendingPaymentsDetailed(controls);
  const sdk = await recoverSdkRecords(controls);
  return {
    collected: legacy.reclaimed + pending.recovered + sdk.collected,
    retryable:
      legacy.deferred -
      legacy.unknownIssuer -
      legacy.spentReplay +
      pending.retryable +
      sdk.retryable,
    unknownIssuer: legacy.unknownIssuer + pending.unknownIssuer + sdk.unknownIssuer,
    spentReplay: legacy.spentReplay + pending.spentReplay + sdk.spentReplay,
  };
}

export type RoutstrRecoveryStatus =
  { kind: 'settled'; message: string } | { kind: 'unresolved'; message: string };

/** The recovery card's wording for a finished pass. */
export function describeRoutstrRecovery(report: RoutstrRecoveryReport): RoutstrRecoveryStatus {
  const unresolved = report.retryable + report.unknownIssuer + report.spentReplay;
  if (unresolved === 0) {
    return {
      kind: 'settled',
      message:
        report.collected > 0
          ? 'Collected leftover AI ecash into your wallet.'
          : 'No leftover AI balance found.',
    };
  }
  const parts: string[] = [];
  if (report.collected > 0) parts.push('Collected available ecash.');
  if (report.retryable > 0)
    parts.push('Some AI nodes did not answer. Your credentials are kept — try again later.');
  if (report.unknownIssuer > 0)
    parts.push('Some records name no AI node to ask, so they are kept as they are.');
  if (report.spentReplay > 0)
    parts.push('Some refunds were already spent at the mint. They are kept so nothing is lost.');
  return { kind: 'unresolved', message: parts.join(' ') };
}
