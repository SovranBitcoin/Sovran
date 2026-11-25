/**
 * @fileoverview The Search tab's one read: what to show for a query.
 *
 * Tier 0 answers on the first character, with no network and no wait: the
 * action card for a pasted payment string, people and mints already on the
 * phone, the discovered-mint list (filtered on the phone from its cached
 * copy), and the Bluetooth row. Tier 1, the remote people search, waits for
 * the one 250 ms pause in `useContactSearch` and streams in under the local
 * people. The field itself emits every keystroke, so there is one wait, not
 * two.
 *
 * A payment string or a secret never reaches the remote search (see
 * `classifySearchQuery`).
 */
import { useMemo } from 'react';

import { BLUETOOTH_TIER_ENTRY, useLocationTiers } from '@/features/bitchat/hooks/useLocationTiers';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';
import { useLocalSearchCandidates } from '@/features/search/hooks/useLocalSearchCandidates';
import { useOverlaidContactSearch } from '@/features/search/hooks/useOverlaidContactSearch';
import { matchLocalMints, matchLocalPeople } from '@/features/search/lib/localSearch';
import { matchTiers } from '@/features/search/lib/matchTiers';
import { parseGeohashQuery } from '@/features/search/lib/parseGeohashQuery';
import {
  classifySearchQuery,
  isRecordableSearch,
  remoteSearchText,
  type SearchQueryKind,
} from '@/features/search/lib/searchAction';
import { buildSearchSections, type SearchListItem } from '@/features/search/lib/searchSections';
import { buildDetectors } from '@/shared/config/featureDetectors';
import { useWalletContext } from '@/runtime/WalletProjection';
import type { SearchStatus } from './searchListState';

/**
 * Place matches use the location only once a query is typed, and only when the
 * person already allowed it: opening Search never shows the location prompt.
 */
const LOCATION_TIER_OPTIONS = { requestPermission: false } as const;

type SearchAggregates = {
  /** Trimmed query the rows reflect. */
  query: string;
  /** What the query is: empty, a secret, a payment string or words. */
  kind: SearchQueryKind;
  /** Header and result rows, in section order. */
  items: SearchListItem[];
  /** Rows per section. */
  counts: { people: number; mints: number; nearby: number };
  /** The remote people search's status; `idle` while it has nothing to do. */
  peopleStatus: SearchStatus;
  /** Length of what the remote people search is given; 0 when it is off for this query. */
  remoteQueryLength: number;
  /** A settled query that found something and may go in recent searches. */
  recordable: boolean;
  retryPeople: () => void;
};

export function useSearchAggregates(query: string): SearchAggregates {
  const walletContext = useWalletContext();
  const trimmed = query.trim();
  const kind = useMemo(
    () => classifySearchQuery(trimmed, buildDetectors, walletContext),
    [trimmed, walletContext]
  );
  const text = kind.kind === 'text' ? kind.query : '';

  const remoteText = remoteSearchText(kind);
  const remote = useOverlaidContactSearch(remoteText);
  const local = useLocalSearchCandidates();
  const { results: discovered } = useMintSearch(text, 'ALL', { enabled: text.length > 0 });
  const { tiers } = useLocationTiers({ ...LOCATION_TIER_OPTIONS, enabled: text.length > 0 });

  const sections = useMemo(() => {
    const lower = text.toLowerCase();
    // The Bluetooth row is always there to match, whatever the location says.
    const allTiers = tiers.some((tier) => tier.transport === 'ble')
      ? tiers
      : [BLUETOOTH_TIER_ENTRY, ...tiers];
    return buildSearchSections({
      action: kind.kind === 'payment' ? kind.descriptor : null,
      localPeople: matchLocalPeople(local.people, text),
      remotePeople: remote.contactRows,
      ownMints: matchLocalMints(local.mints, text),
      discoveredMints: text ? discovered : [],
      geohash: parseGeohashQuery(text),
      tiers: matchTiers(allTiers, lower),
      peopleSearchFailed: remote.status === 'error',
    });
  }, [kind, text, local.people, local.mints, remote.contactRows, remote.status, discovered, tiers]);

  const peopleStatus = remote.status;
  const settled = peopleStatus !== 'loading' && peopleStatus !== 'revalidating';
  const found = sections.counts.people + sections.counts.mints + sections.counts.nearby > 0;

  return {
    query: trimmed,
    kind,
    items: sections.items,
    counts: sections.counts,
    peopleStatus,
    remoteQueryLength: remoteText.length,
    recordable: isRecordableSearch(kind) && settled && found,
    retryPeople: remote.retry,
  };
}
