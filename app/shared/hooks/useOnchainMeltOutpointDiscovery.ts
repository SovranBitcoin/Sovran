import { useEffect } from 'react';

import {
  annotationKey,
  defaultChainAdapter,
  fetchAddressOutpointCandidates,
  matchUniqueSendOutpoint,
} from 'wallet';

import {
  setTransactionAnnotation,
  transactionAnnotationAdapter,
} from '@/shared/stores/profile/transactionAnnotationStore';
import { paymentLog } from '@/shared/lib/logger';

// Same cadence as the receive-side address watcher (useMempoolAddressSummary):
// block discovery is slow, mempool.space is rate-limited, and the payment is
// already in flight — 70s is plenty.
const OUTPOINT_DISCOVERY_POLL_MS = 70_000;

/** The effect body of useOnchainMeltOutpointDiscovery, verbatim; returns its cleanup. */
function startOutpointDiscovery(params: {
  quoteId: string;
  address: string;
  amountSats: number;
  quoteCreatedAtSec: number;
}): () => void {
  const { quoteId, address, amountSats, quoteCreatedAtSec } = params;
  let mounted = true;
  let interval: ReturnType<typeof setInterval> | null = null;

  const probe = async () => {
    // The mint (or an earlier probe) may have provided the outpoint since
    // the last tick — the screen flips `enabled` next render, but don't
    // race a duplicate write in the meantime.
    const key = annotationKey({ type: 'melt', quoteId });
    if (transactionAnnotationAdapter.get(key)?.onchainOutpoint) return;
    try {
      const txs = await fetchAddressOutpointCandidates(address);
      if (!mounted) return;
      const outpoint = matchUniqueSendOutpoint(txs, {
        address,
        amountSats,
        notBeforeSec: quoteCreatedAtSec,
      });
      paymentLog.debug('onchain.melt.outpoint_discovery.result', {
        txCount: txs.length,
        matched: !!outpoint,
        amountSats,
      });
      if (!outpoint) return;
      if (transactionAnnotationAdapter.get(key)?.onchainOutpoint) return;
      paymentLog.info('onchain.melt.outpoint_discovery.adopted', {
        quoteId,
        vout: Number(outpoint.split(':')[1]),
      });
      setTransactionAnnotation(key, {
        onchainMelt: { outpoint, outpointSource: 'heuristic' },
      });
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    } catch (err) {
      paymentLog.warn('onchain.melt.outpoint_discovery.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  void probe();
  interval = setInterval(() => void probe(), OUTPOINT_DISCOVERY_POLL_MS);
  return () => {
    mounted = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/**
 * Best-effort outpoint discovery for an onchain melt whose mint withholds the
 * outpoint while the tx is unconfirmed (cdk-bdk does, despite NUT-30 §216).
 * Watches the DESTINATION address on mempool.space for a tx paying exactly
 * `amountSats`, first seen after the quote was created, and — only on a
 * globally unique match — persists it as a `heuristic` outpoint annotation.
 * The existing annotation → `parseOutpoint` → confirmations-ring/explorer-link
 * pipeline lights up from there with no further UI changes; a mint-provided
 * outpoint later overwrites it (source `mint`).
 *
 * The caller owns the stop conditions via `enabled`: melt PENDING, no outpoint
 * yet, not settled off-chain, mainnet, address + amount known.
 */
export function useOnchainMeltOutpointDiscovery(params: {
  quoteId: string | null | undefined;
  address: string | null | undefined;
  amountSats: number | null | undefined;
  /** Quote creation time in SECONDS (epoch). */
  quoteCreatedAtSec: number | null | undefined;
  enabled: boolean;
}): void {
  const { quoteId, address, amountSats, quoteCreatedAtSec, enabled } = params;

  useEffect(() => {
    if (
      !enabled ||
      !quoteId ||
      !address ||
      amountSats == null ||
      !Number.isFinite(amountSats) ||
      amountSats <= 0 ||
      quoteCreatedAtSec == null ||
      defaultChainAdapter.network !== 'mainnet'
    ) {
      return;
    }
    return startOutpointDiscovery({ quoteId, address, amountSats, quoteCreatedAtSec });
  }, [enabled, quoteId, address, amountSats, quoteCreatedAtSec]);
}
