/**
 * The mechanical half of the changelog: pointer labelling (which feeds the
 * interpreter's fallback sentences) and the invertible-patch pairing rule every
 * fact depends on. The pointer cases are ported from the `Sovran/changes`
 * observatory (`src/decode.test.ts`); the copy those labels used to produce is
 * now pinned by `mintChangesPhrases.test.ts`.
 */
import {
  decodeFeed,
  decodePointer,
  pairPatchOps,
  type RawFeed,
} from '@/features/mint/lib/mintChanges/decode';

describe('decodePointer', () => {
  it('names a NUT by its spec title', () => {
    expect(decodePointer('/nuts/4/methods/0/max_amount').label).toEqual([
      'NUT-04 Minting tokens',
      'method 1',
      'max amount',
    ]);
  });

  it('leaves an unknown NUT unnamed rather than inventing a title', () => {
    expect(decodePointer('/nuts/91/methods').label).toEqual(['NUT-91', 'methods']);
  });

  it('indexes members from one, and capitalises the opening segment', () => {
    expect(decodePointer('/contact/0/info').label).toEqual(['Contact 1', 'info']);
  });

  it('flags an array append and makes the container the subject', () => {
    const { label, append } = decodePointer('/nuts/5/methods/-');
    expect(append).toBe(true);
    expect(label).toEqual(['NUT-05 Melting tokens', 'methods']);
  });

  it('uses NUT-06 field names at the top level', () => {
    expect(decodePointer('/description_long').label).toEqual(['Long description']);
  });
});

describe('pairPatchOps', () => {
  it('pairs the test precondition with the change it guards', () => {
    const ops = pairPatchOps([
      { op: 'test', path: '/nuts/4/methods/0/max_amount', value: 25000 },
      { op: 'replace', path: '/nuts/4/methods/0/max_amount', value: 100000 },
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'replace', before: 25000, value: 100000, hadBefore: true });
  });

  it("keeps a removal's prior value, which only the precondition carries", () => {
    const ops = pairPatchOps([
      { op: 'test', path: '/urls', value: ['https://a.example'] },
      { op: 'remove', path: '/urls' },
    ]);
    expect(ops[0]!.before).toEqual(['https://a.example']);
  });

  it('never emits a bare precondition as a change', () => {
    expect(pairPatchOps([{ op: 'test', path: '/name', value: 'x' }])).toHaveLength(0);
  });

  it('does not pair a test guarding a different path', () => {
    const ops = pairPatchOps([
      { op: 'test', path: '/name', value: 'old' },
      { op: 'add', path: '/motd', value: 'hi' },
    ]);
    expect(ops[0]!.hadBefore).toBe(false);
  });
});

describe('decodeFeed', () => {
  const raw: RawFeed = {
    trackedMints: 3,
    reachableMints: 2,
    totalChanges: 2,
    changes: [
      {
        mintUrl: 'https://mint.example/Bitcoin',
        name: '  ',
        at: 100,
        previousLastSeenAt: 40,
        hash: 'abc123',
        patch: [{ op: 'add', path: '/name', value: 'Example' }],
      },
      {
        mintUrl: 'https://other.example',
        name: 'Other',
        at: 900,
        hash: 'def456',
        summary: ['something upstream could not diff'],
      },
    ],
  };

  it('sorts newest first and does not trust upstream order', () => {
    expect(decodeFeed(raw).entries.map((e) => e.hash)).toEqual(['def456', 'abc123']);
  });

  it('falls back to the host when a mint sends a blank name', () => {
    const entry = decodeFeed(raw).entries.find((e) => e.hash === 'abc123')!;
    expect(entry.name).toBe('mint.example/Bitcoin');
    expect(entry.sincePrevious).toBe(60);
  });

  it('keeps the patch and the upstream summary side by side', () => {
    const entries = decodeFeed(raw).entries;
    expect(entries.find((e) => e.hash === 'abc123')!.patch).toHaveLength(1);
    expect(entries.find((e) => e.hash === 'def456')!.summary).toEqual([
      'something upstream could not diff',
    ]);
  });
});
