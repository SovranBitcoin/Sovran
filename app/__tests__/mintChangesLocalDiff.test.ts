import { buildMintChangeListItems } from '@/features/mint/lib/mintChanges/groupEntries';
import type { Entry } from '@/features/mint/lib/mintChanges/decode';
import {
  applyMintInfoPatch,
  canonicalizeMintInfo,
  diffMintInfo,
  hashMintInfo,
  invertPatch,
  type CanonicalMintInfo,
} from '@/features/mint/lib/mintChanges/localDiff';

/** A NUT-06 answer shaped like the ones the live mints send. */
function info(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Minibits mint',
    pubkey: '03c21ef6f899f661356103552c1945579b0f36f96f9f7d2190ca0cbdab3add4af9',
    version: 'cdk-mintd/0.18.3',
    description: 'Minibits wallet mint.',
    contact: [
      { method: 'nostr', info: 'npub1abc' },
      { method: 'email', info: 'support@minibits.cash' },
    ],
    urls: ['https://mint.minibits.cash/Bitcoin', 'http://minibits.onion'],
    time: 1_795_538_911,
    nuts: {
      '4': {
        methods: [
          { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 25_000 },
          { method: 'bolt11', unit: 'msat', min_amount: 1, max_amount: 2100 },
        ],
        disabled: false,
      },
      '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
      '7': { supported: true },
      '17': {
        supported: [
          { method: 'bolt11', unit: 'sat', commands: ['proof_state', 'bolt11_mint_quote'] },
          { method: 'bolt11', unit: 'msat', commands: ['bolt11_melt_quote', 'proof_state'] },
        ],
      },
      '19': {
        ttl: 300,
        cached_endpoints: [
          { method: 'POST', path: '/v1/swap' },
          { method: 'POST', path: '/v1/mint/bolt11' },
        ],
      },
    },
    ...over,
  };
}

const canon = (raw: unknown): CanonicalMintInfo => {
  const c = canonicalizeMintInfo(raw);
  if (!c) throw new Error('not NUT-06');
  return c;
};

function reversed(raw: Record<string, unknown>): Record<string, unknown> {
  const nuts = raw.nuts as Record<string, Record<string, unknown[]>>;
  return Object.fromEntries(
    Object.entries({
      ...raw,
      contact: [...(raw.contact as unknown[])].reverse(),
      urls: [...(raw.urls as unknown[])].reverse(),
      nuts: Object.fromEntries(
        Object.entries({
          ...nuts,
          '4': { ...nuts['4'], methods: [...nuts['4']!.methods!].reverse() },
          '17': {
            supported: [...nuts['17']!.supported!].reverse().map((entry) => ({
              ...(entry as object),
              commands: [...(entry as { commands: string[] }).commands].reverse(),
            })),
          },
          '19': { ...nuts['19'], cached_endpoints: [...nuts['19']!.cached_endpoints!].reverse() },
        }).reverse()
      ),
    }).reverse()
  );
}

/** Phrase a patch the way Mint history does. */
function phrases(patch: ReturnType<typeof diffMintInfo>, nuts?: Record<string, unknown>): string[] {
  const entry: Entry = {
    mintUrl: 'https://mint.minibits.cash/Bitcoin',
    host: 'mint.minibits.cash/Bitcoin',
    name: 'Minibits mint',
    at: 1,
    hash: 'h',
    patch,
    summary: [],
  };
  return buildMintChangeListItems([entry], () => nuts)[0]!.revisions[0]!.phrases.map((p) =>
    p.detail ? `${p.text} — ${p.detail}` : p.text
  );
}

describe('canonical NUT-06 info', () => {
  it('rejects what is not a NUT-06 document', () => {
    expect(canonicalizeMintInfo(null)).toBeUndefined();
    expect(canonicalizeMintInfo([info()])).toBeUndefined();
    expect(canonicalizeMintInfo({ ...info(), name: 7 })).toBeUndefined();
  });

  it('gives a reordered answer the same hash and no diff', () => {
    const a = canon(info());
    const b = canon(reversed(info()));
    expect(hashMintInfo(a)).toBe(hashMintInfo(b));
    expect(diffMintInfo(a, b)).toEqual([]);
  });

  it('ignores the mint clock', () => {
    const a = canon(info({ time: 1 }));
    const b = canon(info({ time: 999_999 }));
    expect(hashMintInfo(a)).toBe(hashMintInfo(b));
    expect(diffMintInfo(a, b)).toEqual([]);
    expect(a).not.toHaveProperty('time');
  });

  it('sorts NUT-04 methods by (method, unit) and NUT-17 commands', () => {
    const c = canon(info()) as { nuts: Record<string, Record<string, unknown>> };
    expect((c.nuts['4']!.methods as { unit: string }[]).map((m) => m.unit)).toEqual([
      'msat',
      'sat',
    ]);
    expect((c.nuts['17']!.supported as { commands: string[] }[])[1]!.commands).toEqual([
      'bolt11_mint_quote',
      'proof_state',
    ]);
  });
});

describe('invertible RFC 6902 diff', () => {
  it('pairs every replace and remove with a test carrying the old value, with escaped pointers', () => {
    const a = canon(info({ 'odd/key~': 'x', motd: 'Welcome' }));
    const b = canon(info({ 'odd/key~': 'y' }));
    expect(diffMintInfo(a, b)).toEqual([
      { op: 'test', path: '/motd', value: 'Welcome' },
      { op: 'remove', path: '/motd' },
      { op: 'test', path: '/odd~1key~0', value: 'x' },
      { op: 'replace', path: '/odd~1key~0', value: 'y' },
    ]);
  });

  it.each([
    ['name', { name: 'Minibits' }],
    ['description', { description: 'New words.' }],
    ['motd', { motd: 'Upgrading tonight' }],
    ['version', { version: 'cdk-mintd/0.19.0' }],
    ['contact', { contact: [{ method: 'email', info: 'support@minibits.cash' }] }],
    ['urls', { urls: ['https://mint.minibits.cash/Bitcoin'] }],
    [
      'a NUT-04 limit and a rail',
      {
        nuts: {
          ...(info().nuts as object),
          '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 100_000 }] },
        },
      },
    ],
  ])('round-trips a %s change both ways', (_label, over) => {
    const a = canon(info());
    const b = canon(info(over));
    const patch = diffMintInfo(a, b);
    expect(patch.length).toBeGreaterThan(0);
    expect(applyMintInfoPatch(a, patch)).toEqual(b);
    expect(applyMintInfoPatch(b, invertPatch(patch))).toEqual(a);
  });

  it('phrases real changes the way Mint history reads them', () => {
    const a = canon(info());
    const name = phrases(diffMintInfo(a, canon(info({ name: 'Minibits' }))));
    expect(name.join(' | ')).toMatch(/name/i);
    const version = phrases(diffMintInfo(a, canon(info({ version: 'cdk-mintd/0.19.0' }))));
    expect(version.join(' | ')).toMatch(/0\.19\.0/);
    const motd = phrases(diffMintInfo(a, canon(info({ motd: 'Upgrading tonight' }))));
    expect(motd.length).toBe(1);
    const contact = phrases(
      diffMintInfo(
        a,
        canon(
          info({ contact: [...(info().contact as object[]), { method: 'twitter', info: '@m' }] })
        )
      )
    );
    expect(contact.join(' | ')).toMatch(/contact/i);

    const raised = canon(
      info({
        nuts: {
          ...(info().nuts as object),
          '4': {
            methods: [
              { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 100_000 },
              { method: 'bolt11', unit: 'msat', min_amount: 1, max_amount: 2100 },
            ],
            disabled: false,
          },
        },
      })
    );
    const limitPatch = diffMintInfo(a, raised);
    expect(limitPatch).toEqual([
      { op: 'test', path: '/nuts/4/methods/1/max_amount', value: 25_000 },
      { op: 'replace', path: '/nuts/4/methods/1/max_amount', value: 100_000 },
    ]);
    const limit = phrases(limitPatch, raised.nuts as Record<string, unknown>);
    expect(limit).toHaveLength(1);
    expect(limit[0]).toMatch(/100,000|100000|100k/i);

    const dropped = phrases(
      diffMintInfo(
        a,
        canon(
          info({
            nuts: {
              ...(info().nuts as object),
              '4': {
                methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 25_000 }],
                disabled: false,
              },
            },
          })
        )
      )
    );
    expect(dropped.join(' | ')).toMatch(/msat|millisat/i);
  });

  it('replays A → B → A to the same document, as two distinct revisions', () => {
    const a = canon(info());
    const b = canon(info({ version: 'cdk-mintd/0.19.0' }));
    const forward = diffMintInfo(a, b);
    const back = diffMintInfo(b, a);
    expect(back).not.toEqual(forward);
    expect(applyMintInfoPatch(applyMintInfoPatch(a, forward), back)).toEqual(a);
    expect(hashMintInfo(applyMintInfoPatch(a, forward))).toBe(hashMintInfo(b));
  });

  it('refuses a patch whose test does not hold', () => {
    const a = canon(info());
    expect(() =>
      applyMintInfoPatch(a, [
        { op: 'test', path: '/name', value: 'someone else' },
        { op: 'replace', path: '/name', value: 'x' },
      ])
    ).toThrow(/test failed/);
  });
});
