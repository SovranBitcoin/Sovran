import { useEffect, useRef, useState } from 'react';

import { cashuLog } from '@/shared/lib/logger';
import {
  collectRoutstrLeftovers,
  describeRoutstrRecovery,
  readSdkRecoveryCounts,
  storeRecoveryCounts,
  type RoutstrRecoveryStatus,
} from '@/shared/lib/routstr/recovery';
import { selectActivePubkey, useProfileStore } from '@/shared/stores/global/profileStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/**
 * What the recovery screen shows for Routstr money outside the wallet.
 *
 * - `hidden`: nothing is known to be left (or the SDK records are still being
 *   read and the store has none).
 * - `loading`: the store has rows; the SDK records are still being read.
 * - `pending`: leftovers exist and no pass has run on this screen.
 * - `collecting`: a pass is running.
 * - `unresolved`: a pass ran and kept rows: offline, unknown node, spent replay.
 * - `settled`: a pass ran and nothing is left. Its message stands alone, not in
 *   the row with the action.
 */
type RoutstrRecoveryCard =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'collecting' }
  | { kind: 'unresolved'; message: string }
  | { kind: 'settled'; message: string };

const FAILED: RoutstrRecoveryStatus = {
  kind: 'unresolved',
  message: "Couldn't check AI nodes. Your credentials are kept — try again later.",
};

/** One pass. `null` when it was aborted, so a stale answer is never shown. */
async function runCollect(signal: AbortSignal): Promise<RoutstrRecoveryStatus | null> {
  try {
    const report = await collectRoutstrLeftovers({ signal });
    return signal.aborted ? null : describeRoutstrRecovery(report);
  } catch (error) {
    if (signal.aborted) return null;
    // Shown in the card instead of escaping the press handler unhandled.
    cashuLog.warn('recovery.ai_reclaim.failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return FAILED;
  }
}

export function useRoutstrRecoveryCard(enabled: boolean): {
  card: RoutstrRecoveryCard;
  collect: () => Promise<void>;
} {
  const pubkey = useProfileStore(selectActivePubkey);
  const storeTotal = useRoutstrStore((s) => storeRecoveryCounts(s).total);
  const [sdkTotal, setSdkTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<RoutstrRecoveryStatus | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const passRef = useRef<AbortController | null>(null);

  // A different account starts from nothing: its own records, no old answer,
  // and any pass still running for the previous one is stopped.
  useEffect(() => {
    if (!enabled || !pubkey) return;
    const controller = new AbortController();
    void readSdkRecoveryCounts(pubkey).then((counts) => {
      if (!controller.signal.aborted) setSdkTotal(counts.total);
    });
    return () => {
      controller.abort();
    };
  }, [enabled, pubkey, readCount]);

  useEffect(
    () => () => {
      passRef.current?.abort();
      passRef.current = null;
      setStatus(null);
      setCollecting(false);
      setSdkTotal(null);
    },
    [pubkey]
  );

  const collect = async () => {
    if (!enabled || collecting) return;
    passRef.current?.abort();
    const controller = new AbortController();
    passRef.current = controller;
    setCollecting(true);
    setStatus(null);
    const next = await runCollect(controller.signal);
    if (next === null) return;
    setStatus(next);
    setCollecting(false);
    setReadCount((n) => n + 1);
  };

  const card = toCard({ enabled, collecting, status, storeTotal, sdkTotal });
  return { card, collect };
}

function toCard(input: {
  enabled: boolean;
  collecting: boolean;
  status: RoutstrRecoveryStatus | null;
  storeTotal: number;
  sdkTotal: number | null;
}): RoutstrRecoveryCard {
  if (!input.enabled) return { kind: 'hidden' };
  if (input.collecting) return { kind: 'collecting' };
  if (input.status) return input.status;
  if (input.sdkTotal === null)
    return input.storeTotal > 0 ? { kind: 'loading' } : { kind: 'hidden' };
  return input.storeTotal + input.sdkTotal > 0 ? { kind: 'pending' } : { kind: 'hidden' };
}
