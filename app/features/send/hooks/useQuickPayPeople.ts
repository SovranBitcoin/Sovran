/**
 * @fileoverview Quick-pay tier for the Send modal.
 *
 * Consolidates two EXISTING sources of truth — without duplicating either:
 *   • transaction history (`useHistoryWithMelts` + colada `getCounterparty`)
 *     gives everyone we've sent to (`sent`) or been paid by (`received`);
 *   • `recentPeopleStore` gives nearby-mesh peers we've resolved (`peer`).
 *
 * They're merged per pubkey keyed on the MOST RECENT interaction (so the row's
 * source label + ordering both follow "last sent / last seen"), profile
 * metadata is hydrated, and the list is returned newest-first. The hook is the
 * only consolidation point; callers just render.
 */

import { useMemo } from 'react';
import { getCounterparty } from 'wallet';

import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { useRecentPeopleProfiles } from '@/features/feed/hooks/useRecentPeopleProfiles';
import {
  normalizeRecentPersonPubkey,
  selectRecentPeople,
  useRecentPeopleStore,
} from '@/shared/stores/profile/recentPeopleStore';
import { resolveIdentityName } from '@/shared/lib/identity';
import {
  mergeQuickPayContributions,
  type QuickPayContribution,
  type QuickPaySource,
} from '@/features/send/lib/quickPayMerge';

export type { QuickPaySource } from '@/features/send/lib/quickPayMerge';

export interface QuickPayPerson {
  pubkey: string;
  source: QuickPaySource;
  /** Always a real name — never null / "Unknown" (falls back to a word-pair). */
  displayName: string;
  picture: string | null;
  lud16: string | null;
  nip05: string | null;
  isLoading: boolean;
}

/**
 * @param excludePubkeys normalized hex pubkeys to omit (e.g. peers already
 *   surfaced live in the "Nearby" tier so they don't appear twice).
 */
export function useQuickPayPeople(excludePubkeys: readonly string[] = []): QuickPayPerson[] {
  const { history } = useHistoryWithMelts();
  const recentPeople = useRecentPeopleStore((state) => state.entries);

  // Sent / received — derived from the transaction annotations (NOT stored
  // separately). The annotation already carries the counterparty's name/avatar,
  // so we read it straight off the entry (no extra fetch, shows immediately).
  const txContributions = useMemo<QuickPayContribution[]>(() => {
    const byPubkey = new Map<string, QuickPayContribution>();
    for (const entry of history) {
      const counterparty = getCounterparty(entry);
      const pubkey = normalizeRecentPersonPubkey(counterparty?.pubkey);
      if (!pubkey || !counterparty?.direction) continue;
      const source: QuickPaySource = counterparty.direction === 'recipient' ? 'sent' : 'received';
      const at = entry.createdAt ?? 0;
      const existing = byPubkey.get(pubkey);
      if (!existing || at > existing.at) {
        byPubkey.set(pubkey, {
          pubkey,
          source,
          at,
          displayName: counterparty.displayName ?? null,
          picture: counterparty.avatarUrl ?? null,
          nip05: counterparty.nip05 ?? null,
        });
      }
    }
    return Array.from(byPubkey.values());
  }, [history]);

  // Searched/viewed people AND nearby-mesh peers — from the store, tagged by
  // their `reason`. Peers carry the BLE nickname captured at sighting (their
  // only name; most have no kind-0 to fetch); searched people resolve via the
  // profile hydration below.
  const storeContributions = useMemo<QuickPayContribution[]>(
    () =>
      selectRecentPeople(recentPeople).map((entry) => ({
        pubkey: entry.pubkey,
        source: entry.reason,
        at: entry.lastOpenedAt,
        displayName: entry.displayName ?? null,
      })),
    [recentPeople]
  );

  const excludeKey = excludePubkeys.join(',');
  const merged = useMemo(() => {
    const exclude = new Set(excludeKey ? excludeKey.split(',') : []);
    return mergeQuickPayContributions([...txContributions, ...storeContributions], exclude);
  }, [txContributions, storeContributions, excludeKey]);

  const pubkeys = useMemo(() => merged.map((contribution) => contribution.pubkey), [merged]);
  const profiles = useRecentPeopleProfiles(pubkeys);
  const profileByPubkey = useMemo(
    () => new Map(profiles.map((row) => [row.pubkey, row])),
    [profiles]
  );

  return useMemo(
    () =>
      merged.map((contribution) => {
        const row = profileByPubkey.get(contribution.pubkey);
        const metadata = row?.metadata;
        // Prefer a fresh kind-0 name, then the source's own name, then a
        // deterministic word-pair — so the row is never blank / "Unknown".
        const displayName = resolveIdentityName({
          pubkey: contribution.pubkey,
          nostrProfile: metadata,
          bleNickname: contribution.displayName ?? undefined,
        });
        return {
          pubkey: contribution.pubkey,
          source: contribution.source,
          displayName,
          picture: metadata?.picture ?? contribution.picture ?? null,
          lud16: metadata?.lud16 ?? null,
          nip05: metadata?.nip05 ?? contribution.nip05 ?? null,
          isLoading: row?.isLoading ?? false,
        };
      }),
    [merged, profileByPubkey]
  );
}
