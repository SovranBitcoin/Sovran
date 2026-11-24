/**
 * @fileoverview The Search tab's one list, in sections.
 *
 * Order: the action card for a pasted payment string, then People (people
 * already on the phone, then the remote search's), then Mints (the account's
 * own, then discovered ones), then Nearby (Bluetooth, places, a geohash).
 * Each section is a header row followed by its rows, flattened into one array
 * so one virtualized list renders it; a section with no rows is left out.
 *
 * Pure so ordering, de-duplication and the caps can be tested without React.
 */
import type { DestinationDescriptor } from 'wallet';

import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import type { MintSearchResult } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import type { LocalMintCandidate, LocalPersonCandidate } from './localSearch';

/** Rows the discovered-mints part of Mints shows. Discovery returns hundreds. */
export const DISCOVERED_MINTS_LIMIT = 20;
/** Rows the remote people search contributes (it asks the service for 10). */
export const REMOTE_PEOPLE_LIMIT = 10;

export type SearchSectionId = 'people' | 'mints' | 'nearby';

export type PersonSource = LocalPersonCandidate['source'] | 'search';

/** What a person row shows; a remote search hit carries more of it. */
export interface PersonProfile {
  displayName?: string;
  name?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  score?: number | null;
  followers?: number | null;
  follows?: number | null;
}

export type SearchListItem =
  | { type: 'header'; id: string; section: SearchSectionId; title: string }
  | { type: 'action'; id: 'action'; descriptor: DestinationDescriptor }
  | {
      type: 'person';
      id: string;
      pubkey: string;
      source: PersonSource;
      profile?: PersonProfile;
      isLoadingProfile: boolean;
    }
  | {
      type: 'mint';
      id: string;
      mintUrl: string;
      /** In the person's account (shown first, with no discovery stats). */
      owned: boolean;
      displayName?: string;
      iconUrl?: string;
      kymScore?: number;
      reviewCount?: number;
    }
  | { type: 'geohash'; id: string; geohash: string }
  | { type: 'tier'; id: string; tier: TierEntry }
  /** The remote people search failed while other rows are on screen. */
  | { type: 'people-error'; id: 'people-error' };

/** A remote people-search row, after the kind-0 overlay. */
export interface RemotePersonRow {
  pubkey: string;
  profile?: PersonProfile;
  isLoadingProfile: boolean;
}

export interface SearchSectionsInput {
  action: DestinationDescriptor | null;
  localPeople: readonly LocalPersonCandidate[];
  remotePeople: readonly RemotePersonRow[];
  ownMints: readonly LocalMintCandidate[];
  discoveredMints: readonly MintSearchResult[];
  geohash: string | null;
  tiers: readonly TierEntry[];
  /**
   * The remote people search failed. With other rows on screen, People ends
   * with an inline error and retry; with none, the list's own error state
   * says so instead.
   */
  peopleSearchFailed?: boolean;
}

interface SearchSections {
  items: SearchListItem[];
  counts: { people: number; mints: number; nearby: number };
}

const SECTION_TITLE: Record<SearchSectionId, string> = {
  people: 'People',
  mints: 'Mints',
  nearby: 'Nearby',
};

function localProfile(person: LocalPersonCandidate): PersonProfile {
  const profile: PersonProfile = {
    ...(person.displayName ? { displayName: person.displayName } : {}),
    ...(person.name ? { name: person.name } : {}),
    ...(person.picture ? { picture: person.picture } : {}),
    ...(person.nip05 ? { nip05: person.nip05 } : {}),
    ...(person.lud16 ? { lud16: person.lud16 } : {}),
  };
  return profile;
}

function peopleRows(input: SearchSectionsInput): SearchListItem[] {
  const seen = new Set<string>();
  const rows: SearchListItem[] = [];
  for (const person of input.localPeople) {
    if (seen.has(person.pubkey)) continue;
    seen.add(person.pubkey);
    rows.push({
      type: 'person',
      id: `person:${person.pubkey}`,
      pubkey: person.pubkey,
      source: person.source,
      profile: localProfile(person),
      isLoadingProfile: false,
    });
  }
  let remote = 0;
  for (const person of input.remotePeople) {
    if (remote >= REMOTE_PEOPLE_LIMIT) break;
    if (seen.has(person.pubkey)) continue;
    seen.add(person.pubkey);
    remote += 1;
    rows.push({
      type: 'person',
      id: `person:${person.pubkey}`,
      pubkey: person.pubkey,
      source: 'search',
      profile: person.profile,
      isLoadingProfile: person.isLoadingProfile,
    });
  }
  return rows;
}

function mintRows(input: SearchSectionsInput): SearchListItem[] {
  const seen = new Set<string>();
  const rows: SearchListItem[] = [];
  for (const mint of input.ownMints) {
    const key = normalizeMintUrlKey(mint.mintUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: 'mint',
      id: `mint:${key}`,
      mintUrl: mint.mintUrl,
      owned: true,
      ...(mint.displayName ? { displayName: mint.displayName } : {}),
      ...(mint.iconUrl ? { iconUrl: mint.iconUrl } : {}),
    });
  }
  let discovered = 0;
  for (const mint of input.discoveredMints) {
    if (discovered >= DISCOVERED_MINTS_LIMIT) break;
    const key = normalizeMintUrlKey(mint.url);
    if (seen.has(key)) continue;
    seen.add(key);
    discovered += 1;
    const info = (mint.info ?? {}) as { icon_url?: string | null; name?: string };
    rows.push({
      type: 'mint',
      id: `mint:${key}`,
      mintUrl: mint.url,
      owned: false,
      ...(info.name ? { displayName: info.name } : {}),
      ...(info.icon_url ? { iconUrl: info.icon_url } : {}),
      ...(typeof mint.review_score === 'number' ? { kymScore: mint.review_score } : {}),
      ...(typeof mint.review_count === 'number' ? { reviewCount: mint.review_count } : {}),
    });
  }
  return rows;
}

function nearbyRows(input: SearchSectionsInput): SearchListItem[] {
  const rows: SearchListItem[] = [];
  const seen = new Set<string>();
  // Bluetooth first: it works with no location at all.
  const tiers = [...input.tiers].sort(
    (a, b) => Number(b.transport === 'ble') - Number(a.transport === 'ble')
  );
  for (const tier of tiers) {
    if (seen.has(tier.key)) continue;
    seen.add(tier.key);
    rows.push({ type: 'tier', id: `tier:${tier.key}`, tier });
  }
  if (input.geohash) {
    rows.push({ type: 'geohash', id: `geohash:${input.geohash}`, geohash: input.geohash });
  }
  return rows;
}

function withHeader(section: SearchSectionId, rows: SearchListItem[]): SearchListItem[] {
  if (rows.length === 0) return [];
  return [
    { type: 'header', id: `header:${section}`, section, title: SECTION_TITLE[section] },
    ...rows,
  ];
}

export function buildSearchSections(input: SearchSectionsInput): SearchSections {
  const people = peopleRows(input);
  const mints = mintRows(input);
  const nearby = nearbyRows(input);
  const anyRows = !!input.action || people.length + mints.length + nearby.length > 0;
  // Local rows stay; the failure is said where its rows would have been.
  const peopleSection: SearchListItem[] =
    input.peopleSearchFailed && anyRows
      ? [...people, { type: 'people-error', id: 'people-error' }]
      : people;
  const items: SearchListItem[] = [
    ...(input.action
      ? [{ type: 'action' as const, id: 'action' as const, descriptor: input.action }]
      : []),
    ...withHeader('people', peopleSection),
    ...withHeader('mints', mints),
    ...withHeader('nearby', nearby),
  ];
  return {
    items,
    counts: { people: people.length, mints: mints.length, nearby: nearby.length },
  };
}
