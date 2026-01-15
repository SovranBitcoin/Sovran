import { TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';

export type HealthSeverity = 'ok' | 'warn' | 'error' | 'info';

export type HealthCta =
  | { type: 'openBalanceSplit'; unit: string }
  | { type: 'openRebalancePlan'; unit: string }
  | { type: 'openPendingEcash' };

export interface HealthSignal {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  cta?: { label: string; action: HealthCta };
}

export interface HealthChip {
  severity: HealthSeverity;
  label: string;
}

export interface WalletHealthResult {
  unit: string;
  chips: HealthChip[];
  signals: HealthSignal[];
}

/**
 * Wallet health is intentionally "signal based" (no arbitrary score):
 * we want a list of concrete, actionable checks that can grow over time.
 */

function formatPctFromBp(bp: number): string {
  return `${(bp / 100).toFixed(0)}%`;
}

function normalizeBpLargestRemainder(
  mintUrls: string[],
  balances: Record<string, number>,
  total: number
): Record<string, number> {
  // We use largest-remainder rounding so:
  // - the resulting bp always sums to exactly 10,000
  // - results are deterministic across renders (stable tie-break by mintUrl)
  if (total <= 0) {
    return mintUrls.reduce(
      (acc, url) => {
        acc[url] = 0;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  const rows = mintUrls.map((mintUrl) => {
    const bal = balances[mintUrl] || 0;
    const exact = (bal / total) * TOTAL_BASIS_POINTS;
    const floor = Math.floor(exact);
    return { mintUrl, floor, remainder: exact - floor };
  });

  const floorSum = rows.reduce((s, r) => s + r.floor, 0);
  let remaining = TOTAL_BASIS_POINTS - floorSum;

  rows.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.mintUrl.localeCompare(b.mintUrl);
  });

  const out: Record<string, number> = {};
  for (const r of rows) {
    if (remaining > 0) {
      out[r.mintUrl] = r.floor + 1;
      remaining--;
    } else {
      out[r.mintUrl] = r.floor;
    }
  }
  return out;
}

export function computeWalletHealth({
  unit,
  mintUrlsForUnit,
  balancesByMintUrl,
  desiredDistributionBp,
  pendingOutgoingCount,
}: {
  unit: string;
  mintUrlsForUnit: string[];
  balancesByMintUrl: Record<string, number>;
  desiredDistributionBp: Record<string, number> | undefined;
  pendingOutgoingCount: number;
}): WalletHealthResult {
  const normalizedUnit = unit.toLowerCase();
  const desired = desiredDistributionBp || {};

  const total = mintUrlsForUnit.reduce((sum, url) => sum + (balancesByMintUrl[url] || 0), 0);

  const hasDesired = Object.values(desired).some((v) => (v || 0) > 0);

  const chips: HealthChip[] = [];
  const signals: HealthSignal[] = [];

  if (total <= 0) {
    chips.push({ severity: 'info', label: 'No balance' });
    signals.push({
      id: 'no-balance',
      severity: 'info',
      title: 'No balance',
      detail: 'There is no balance for this unit, so distribution health can’t be evaluated.',
    });
  } else if (!hasDesired) {
    chips.push({ severity: 'warn', label: 'Not configured' });
    signals.push({
      id: 'distribution-not-configured',
      severity: 'warn',
      title: 'Balance split not configured',
      detail: 'Set a desired mint distribution to track drift and rebalance automatically.',
      cta: {
        label: 'Set balance split',
        action: { type: 'openBalanceSplit', unit: normalizedUnit },
      },
    });
  } else {
    const actualBp = normalizeBpLargestRemainder(mintUrlsForUnit, balancesByMintUrl, total);

    let maxDriftBp = 0;
    for (const url of mintUrlsForUnit) {
      const d = desired[url] || 0;
      const a = actualBp[url] || 0;
      maxDriftBp = Math.max(maxDriftBp, Math.abs(a - d));
    }

    // Threshold: if any mint is off by >= ~2% we surface it as "Needs rebalance".
    // (We keep this conservative: it’s meant to be a quick nudge, not a precise metric.)
    const needsRebalance = maxDriftBp >= 200;
    chips.push({
      severity: needsRebalance ? 'warn' : 'ok',
      label: needsRebalance ? 'Needs rebalance' : 'Balanced',
    });

    signals.push({
      id: 'distribution-drift',
      severity: needsRebalance ? 'warn' : 'ok',
      title: 'Distribution drift',
      detail: needsRebalance
        ? `One or more mints are off by ~${formatPctFromBp(maxDriftBp)} from your desired split.`
        : 'Your current balances are close to your desired split.',
      cta: needsRebalance
        ? { label: 'Rebalance', action: { type: 'openRebalancePlan', unit: normalizedUnit } }
        : {
            label: 'Edit balance split',
            action: { type: 'openBalanceSplit', unit: normalizedUnit },
          },
    });

    const largestShareBp = Math.max(...mintUrlsForUnit.map((url) => actualBp[url] || 0));
    if (largestShareBp >= 8000) {
      chips.push({ severity: 'warn', label: 'Concentrated' });
      signals.push({
        id: 'concentration',
        severity: 'warn',
        title: 'Concentration risk',
        detail: `One mint holds ~${formatPctFromBp(largestShareBp)} of your balance for this unit.`,
      });
    }
  }

  if (pendingOutgoingCount > 0) {
    chips.push({ severity: 'info', label: 'Pending outgoing' });
    signals.push({
      id: 'pending-outgoing',
      severity: 'info',
      title: 'Pending outgoing ecash',
      detail: `You have ${pendingOutgoingCount} unclaimed outgoing token${pendingOutgoingCount === 1 ? '' : 's'}.`,
      cta: { label: 'View & Reclaim', action: { type: 'openPendingEcash' } },
    });
  }

  // Keep card minimal: only show up to 2 chips on the card; modal can show everything.
  const minimalChips = chips.slice(0, 2);

  return { unit: normalizedUnit, chips: minimalChips, signals };
}
