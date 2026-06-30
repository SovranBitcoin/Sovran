/**
 * @fileoverview Pure merge logic for the Send modal's quick-pay tier.
 *
 * Kept dependency-free (no React, no stores, no colada) so the ordering/dedupe
 * rules are unit-testable in isolation. `useQuickPayPeople` builds the
 * contributions from the live sources and calls this.
 */

/** Why this person is a quick-pay candidate — drives the row subtitle. */
export type QuickPaySource = 'sent' | 'received' | 'peer' | 'search';

export interface QuickPayContribution {
  pubkey: string;
  source: QuickPaySource;
  /** ms — when this interaction happened. */
  at: number;
  /** Name carried by the source (counterparty annotation / peer nickname). */
  displayName?: string | null;
  picture?: string | null;
  nip05?: string | null;
}

const QUICK_PAY_LIMIT = 8;

/**
 * Collapse contributions to one row per pubkey, keeping the most recent
 * interaction's source + timestamp, then drop excluded pubkeys, order
 * newest-first, and cap.
 */
export function mergeQuickPayContributions(
  contributions: readonly QuickPayContribution[],
  exclude: ReadonlySet<string>,
  limit = QUICK_PAY_LIMIT
): QuickPayContribution[] {
  const byPubkey = new Map<string, QuickPayContribution>();
  for (const contribution of contributions) {
    const existing = byPubkey.get(contribution.pubkey);
    if (!existing || contribution.at > existing.at) byPubkey.set(contribution.pubkey, contribution);
  }
  return Array.from(byPubkey.values())
    .filter((contribution) => !exclude.has(contribution.pubkey))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
