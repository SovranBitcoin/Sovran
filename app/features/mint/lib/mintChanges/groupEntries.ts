/**
 * Decoded revisions → the two shapes the UI reads.
 *
 * `buildMintChangeListItems` groups by mint, phrasing each revision on its own —
 * that's what the detail screen walks. `flattenMintChangeUpdates` then spreads
 * every phrase back out into its own row for the Mints tab, so a revision that
 * did four things shows four updates rather than one plus a count.
 */
import type { Entry } from './decode';
import { interpretPatch, type NutsMap } from './interpret';
import { phraseFacts, type MintChangePhrase } from './phrase';

export type MintChangeRevision = {
  entry: Entry;
  phrases: MintChangePhrase[];
};

type MintChangeListItem = {
  id: string;
  mintUrl: string;
  name: string;
  host: string;
  latestAt: number;
  /** Newest first. */
  revisions: MintChangeRevision[];
};

/** One row on the Mints tab: one thing one mint did, at one moment. */
export type MintChangeUpdate = {
  id: string;
  mintUrl: string;
  name: string;
  host: string;
  at: number;
  phrase: MintChangePhrase;
};

/**
 * `nutsFor` supplies a mint's CURRENT capability map so a unit-less limit op can
 * still name its unit. Omit it and limits simply go unqualified.
 */
export function buildMintChangeListItems(
  entries: readonly Entry[],
  nutsFor?: (mintUrl: string) => NutsMap
): MintChangeListItem[] {
  const byMint = new Map<string, Entry[]>();
  for (const entry of entries) {
    const existing = byMint.get(entry.mintUrl);
    if (existing) existing.push(entry);
    else byMint.set(entry.mintUrl, [entry]);
  }

  const items: MintChangeListItem[] = [];
  for (const [mintUrl, mintEntries] of byMint) {
    const sorted = [...mintEntries].sort((a, b) => b.at - a.at);
    const newest = sorted[0]!;
    const nuts = nutsFor?.(mintUrl);

    items.push({
      id: `mint-change:${mintUrl}:${newest.hash}`,
      mintUrl,
      name: newest.name,
      host: newest.host,
      latestAt: newest.at,
      revisions: sorted.map((entry) => ({
        entry,
        phrases: phraseFacts(interpretPatch(entry.patch, nuts)),
      })),
    });
  }

  return items.sort((a, b) => b.latestAt - a.latestAt);
}

/**
 * Every phrase from every revision as its own row, newest first. A mint that
 * added a rail and bumped its version in one revision earns two rows: both
 * happened, and hiding one behind a "+1 more" only made the reader tap to find
 * out it was a version bump.
 */
export function flattenMintChangeUpdates(items: readonly MintChangeListItem[]): MintChangeUpdate[] {
  const updates: MintChangeUpdate[] = [];
  for (const item of items) {
    for (const revision of item.revisions) {
      revision.phrases.forEach((phrase, index) => {
        updates.push({
          id: `${revision.entry.hash}:${index}`,
          mintUrl: item.mintUrl,
          name: item.name,
          host: item.host,
          at: revision.entry.at,
          phrase,
        });
      });
    }
  }
  // Within one revision the ranked order stands, so a rail change still reads
  // above the version bump it shipped with.
  return updates.sort((a, b) => b.at - a.at || a.phrase.rank - b.phrase.rank);
}
