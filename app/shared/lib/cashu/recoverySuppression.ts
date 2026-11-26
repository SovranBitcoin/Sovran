/**
 * Coalesces coco's event fan-out for the duration of a recovery run.
 *
 * Restore emits `mint:added` / `mint:updated` / `mint:trusted` / `proofs:saved`
 * constantly, and four independent subscribers react to each one:
 * `useMintManagement` reloads the trusted-mint list, `useMintKeysetUnits`
 * re-reads every mint's keysets (JSON-parsing a 64-entry keypair blob each),
 * coco-react's `BalanceProvider` runs *four* full ready-proof table scans, and
 * `WalletContextProvider` re-reads proofs per mint. None of that intermediate
 * state is worth showing — the recovery screen renders its own progress, and
 * the wallet behind it is not on screen.
 *
 * The cost is quadratic in mint count, because each event's handlers iterate
 * every trusted mint while restore keeps adding more: measured at roughly 140
 * redundant queries for 5 mints, and tens of thousands once "Search all mints"
 * has trusted a hundred of them. All of it lands on the same JS thread and the
 * same single SQLite connection the restore itself needs.
 *
 * So: while suppressed, subscribers register a keyed refresh instead of running
 * it. Keys coalesce — a hundred `mint:updated` events leave one pending refresh
 * per subscriber — and everything runs once when recovery ends.
 *
 * Deliberately a module singleton rather than context: the subscribers live in
 * unrelated parts of the tree, and one of them (`BalanceProvider`) is inside
 * node_modules.
 */
import { cashuLog } from '@/shared/lib/logger';
import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';

let owner: symbol | undefined;
const pending = new Map<string, () => void>();

registerAccountScoped(
  'wallet.recovery-suppression',
  () => {
    owner = undefined;
    pending.clear();
  },
  () => owner === undefined && pending.size === 0
);

/**
 * Ask to defer a refresh. Returns true when the caller should skip its work —
 * the callback is held and replayed once, on the owning run's end callback.
 */
export function deferWhileRecovering(key: string, flush: () => void): boolean {
  if (!owner) return false;
  pending.set(key, flush);
  return true;
}

/** Returns an end callback that can only flush this run's deferred refreshes. */
export function beginRecoverySuppression(): () => void {
  const token = Symbol();
  owner = token;
  pending.clear();
  cashuLog.info('cashu.recovery_suppression.begin', {});
  return () => {
    if (owner === token) flushRecoverySuppression();
  };
}

function flushRecoverySuppression(): void {
  owner = undefined;
  const flushes = [...pending.values()];
  const keys = [...pending.keys()];
  pending.clear();
  cashuLog.info('cashu.recovery_suppression.end', {
    flushed: flushes.length,
    keys: keys.join(','),
  });
  for (const flush of flushes) {
    try {
      flush();
    } catch (error) {
      cashuLog.warn('cashu.recovery_suppression.flush_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function isRecoverySuppressed(): boolean {
  return owner !== undefined;
}
