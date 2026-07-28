/**
 * The copy gate. `fixtures/mintChangesSample.json` is the real nagg changelog
 * (21 revisions across 13 mints, fetched 2026-07-28); these assertions pin the
 * exact sentence each one produces, so a change to the interpreter or the
 * phrasing has to be argued for in the diff rather than slipping through.
 */
import { decodeFeed, type RawFeed } from '@/features/mint/lib/mintChanges/decode';
import {
  buildMintChangeListItems,
  flattenMintChangeUpdates,
} from '@/features/mint/lib/mintChanges/groupEntries';
import { interpretPatch } from '@/features/mint/lib/mintChanges/interpret';
import { phraseFacts } from '@/features/mint/lib/mintChanges/phrase';

import sample from './fixtures/mintChangesSample.json';

const feed = decodeFeed(sample as RawFeed);

/** Sentences for one revision, identified by its content hash. */
function phrasesForHash(hash: string, nuts?: Record<string, unknown>): string[] {
  const entry = feed.entries.find((e) => e.hash === hash);
  if (!entry) throw new Error(`fixture has no revision ${hash}`);
  return phraseFacts(interpretPatch(entry.patch, nuts)).map((p) => p.text);
}

/** The whole feed, unfiltered: grouped per mint, then one row per update. */
const items = buildMintChangeListItems(feed.entries);
const updates = flattenMintChangeUpdates(items);
/** The newest row for one mint, as the Mints tab would read it. */
const headline = (mintUrl: string) => {
  const update = updates.find((u) => u.mintUrl === mintUrl);
  if (!update) throw new Error(`fixture has no mint ${mintUrl}`);
  return `${update.name} ${update.phrase.text}`;
};

describe('payment rails', () => {
  it('reads a method added to minting and melting as one sending & receiving sentence', () => {
    // WesternBTC added the onchain method to NUT-04 and NUT-05 in one revision,
    // plus the NUT-17/19/29 plumbing that rides along with it.
    expect(
      phrasesForHash('0c57c1ead461a14ca9abc67caca1fa33bb71dd5298260c6ad85a506ac5487e2e')
    ).toEqual(['added Onchain sending & receiving']);
  });

  it('names the unit when a mint drops a non-sat rail', () => {
    expect(
      phrasesForHash('6644dbc1c418aa1d9ce481ed777eb6ddce4c382a9d73897f6f840a9c7e9685d8')
    ).toEqual(['dropped Lightning sending & receiving in msat']);
  });
});

describe('limits', () => {
  it('merges an identical cap raise on both directions', () => {
    expect(
      phrasesForHash('231df763cab147a2be30d6338d908291116113b6d6e15fefb6c645f814483117')
    ).toEqual(['raised its limits to 100,000']);
  });

  it("names the unit from the mint's current info when the patch omits it", () => {
    const nuts = {
      '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
      '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
    };
    expect(
      phrasesForHash('231df763cab147a2be30d6338d908291116113b6d6e15fefb6c645f814483117', nuts)
    ).toEqual(['raised its limits to 100,000 sats']);
  });

  it('folds a min and a max set together into one range', () => {
    expect(
      phrasesForHash('0bc8e442880bd94f8955ab87cd7f2bf0dee17bfaadd55bd7dbefbb843a992b19')
    ).toEqual(['set its limits to 0–2,100']);
  });
});

describe('capabilities and software', () => {
  it('drops method_name churn and reports only the software bump', () => {
    // Nutshell 0.20.3 added `method_name` to every mint at once — not news.
    expect(
      phrasesForHash('2b95e47a3be748bd22fc72e6ba8bd6f50df511816a9ff99d9e35c79f48df6dce')
    ).toEqual(['updated its software']);
  });

  it('leads with the capability, not the version, when both moved', () => {
    expect(
      phrasesForHash('86f33c7b2a27b472a18b3a8656dc3271daae673b169555442d26216fe5dcc3f8')
    ).toEqual(['added batched deposits', 'updated its software']);
  });

  it('names a lone capability flag', () => {
    expect(
      phrasesForHash('9ba82184fb91fe7ac5949bb7aecc1cb6018fc22b133e85f2b0e568e24f9df395')
    ).toEqual(['added safer retries']);
  });

  it('says which implementation a mint switched to', () => {
    const phrases = phrasesForHash(
      'e0e22f35ca30da4ffc39daa4d4c7919c09c58794c22ea0d68400e0a4b8235978'
    );
    expect(phrases).toContain('switched to cdk-mintd');
  });
});

describe('identity and security', () => {
  it('ranks a key rotation above everything else in the same revision', () => {
    const phrases = phrasesForHash(
      'e0e22f35ca30da4ffc39daa4d4c7919c09c58794c22ea0d68400e0a4b8235978'
    );
    expect(phrases[0]).toBe('rotated its mint key');
  });

  it('reads a new mint URL as an address, not a JSON pointer', () => {
    expect(
      phrasesForHash('40d41d60122fa69945075d790ebb756b3a8454d52b265bd3b9dc82b6e7a216bb')
    ).toEqual(['added a new address']);
  });

  it('collapses a name and description landing together into one profile update', () => {
    expect(
      phrasesForHash('8896cc662ac9fa098d8bf71bc356588cb6ecfe73f05534352238a46456febac5')
    ).toEqual(['updated its profile']);
  });

  it('names a rename by the name it left behind — the row already shows the new one', () => {
    expect(
      phrasesForHash('c21b54eb2846ec8f8e4021d721661b3fdecbd0c528ab02f8ec88812c7cfc64e5')
    ).toEqual(['renamed itself from nostrzap.me mint']);
  });

  it('names the contact method a mint published', () => {
    expect(
      phrasesForHash('91ffea2516b27d08e9caf5ac1e59ae930311871d1aef73c8fb15b37933a65887')
    ).toEqual(['added an email contact']);
  });
});

describe('the list', () => {
  it('groups the feed to one item per mint, newest first', () => {
    expect(items).toHaveLength(13);
    expect(items.map((i) => i.latestAt)).toEqual(
      [...items.map((i) => i.latestAt)].sort((a, b) => b - a)
    );
  });

  it('gives every update its own row, newest first', () => {
    // 21 revisions across 13 mints, each saying one or more things.
    expect(updates.length).toBeGreaterThan(items.length);
    expect(updates.map((u) => u.at)).toEqual([...updates.map((u) => u.at)].sort((a, b) => b - a));
    expect(updates.every((u) => !!u.phrase.text && !!u.phrase.icon)).toBe(true);
  });

  it("leads each mint with its newest revision's most consequential change", () => {
    expect(headline('https://mint.sovran.money')).toBe('Sovran added batched deposits');
    expect(headline('https://mint.westernbtc.com')).toBe(
      'WesternBTC Cashu mint added Onchain sending & receiving'
    );
    expect(headline('https://mint.macadamia.cash')).toBe('macadamia Mint updated its software');
    expect(headline('https://mint.hanbitkorea.org')).toBe('Hanbit mint added a new address');
  });

  it('ranks within a revision, so the key rotation outranks the version it shipped with', () => {
    const westernbtc = updates.filter((u) => u.mintUrl === 'https://mint.westernbtc.com');
    const olderRevision = westernbtc.filter((u) => u.at === westernbtc[1]!.at);
    expect(olderRevision[0]!.phrase.text).toBe('rotated its mint key');
    expect(olderRevision.at(-1)!.phrase.text).toBe('switched to cdk-mintd');
  });

  it('keeps each revision of a mint as its own dated rows', () => {
    // peeenuts added msat rails, set limits on them, then dropped the rails.
    const peeenuts = items.find((i) => i.mintUrl === 'https://mint.wolfcoil.com')!;
    expect(peeenuts.revisions).toHaveLength(4);
    const rows = updates.filter((u) => u.mintUrl === 'https://mint.wolfcoil.com');
    expect(rows[0]!.phrase.text).toBe('dropped Lightning sending & receiving in msat');
    expect(rows.map((u) => u.phrase.text)).toContain('added Lightning sending & receiving in msat');
    expect(new Set(rows.map((u) => u.at)).size).toBe(4);
  });
});
