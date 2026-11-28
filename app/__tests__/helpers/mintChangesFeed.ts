/**
 * Test-only decoder for the mint changelog feed shape
 * (`fixtures/mintChangesSample.json`, ported from the `Sovran/changes`
 * observatory). The app builds its entries from local mint history, not from
 * this feed, so it lives with the tests that pin the interpreter and phrasing.
 */
import type { Entry, PatchOp } from '@/features/mint/lib/mintChanges/decode';

export type RawChange = {
  mintUrl: string;
  name?: string;
  at: number;
  previousLastSeenAt?: number;
  hash: string;
  summary?: string[];
  patch?: PatchOp[];
};

export type RawFeed = {
  trackedMints: number;
  reachableMints: number;
  totalChanges: number;
  changes: RawChange[];
};

type Feed = {
  tracked: number;
  reachable: number;
  total: number;
  entries: Entry[];
};

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
};

export function decodeFeed(raw: RawFeed): Feed {
  const entries: Entry[] = (raw.changes ?? [])
    .map((c) => ({
      mintUrl: c.mintUrl,
      host: hostOf(c.mintUrl),
      name: c.name?.trim() || hostOf(c.mintUrl),
      at: c.at,
      ...(typeof c.previousLastSeenAt === 'number' && c.previousLastSeenAt > 0
        ? { sincePrevious: c.at - c.previousLastSeenAt }
        : {}),
      hash: c.hash,
      patch: c.patch ?? [],
      summary: c.summary ?? [],
    }))
    // Upstream already sends newest first; do not depend on it.
    .sort((a, b) => b.at - a.at);

  return {
    tracked: raw.trackedMints ?? 0,
    reachable: raw.reachableMints ?? 0,
    total: raw.totalChanges ?? entries.length,
    entries,
  };
}
