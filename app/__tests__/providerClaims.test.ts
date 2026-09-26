/**
 * @jest-environment node
 *
 * The rules that decide what a provider row says.
 *
 * Every case here is something the previous model got wrong in production and
 * the log caught: 14 of 15 visible rows replaced by their hostnames in one
 * write, two of them also changing operator, and ~480 row repaints per viewing
 * for a handful of real changes.
 */

import {
  contestedPubkeySources,
  resolveProvider,
  resolveProviders,
  withClaim,
  type ProviderRecord,
} from '@/shared/lib/routstr/providerClaims';

const URL = 'https://ai.example.com';
const OPERATOR = 'a'.repeat(64);
const IMPOSTOR = 'b'.repeat(64);

const record = (...claims: Parameters<typeof withClaim>[1][]): ProviderRecord =>
  claims.reduce<ProviderRecord | undefined>(
    (acc, source) => withClaim(acc, source, {}),
    undefined
  ) ?? { claims: {} };

describe('who outranks whom', () => {
  it('keeps the provider’s own name when a peer directory disagrees', () => {
    // The production failure, minimised: the peer arrives LAST, and used to
    // win for that reason alone.
    let held = withClaim(undefined, 'self', { name: 'GitHappens2Routstr' });
    held = withClaim(held, 'peer', { name: 'something else' });
    expect(resolveProvider(URL, held).name).toBe('GitHappens2Routstr');
  });

  it('lets a peer name a provider nobody else has named', () => {
    const held = withClaim(undefined, 'peer', { name: 'An OpenRouter Node' });
    expect(resolveProvider(URL, held).name).toBe('An OpenRouter Node');
  });

  it('never invents a name — an unnamed provider resolves to null', () => {
    const held = withClaim(undefined, 'peer', { mints: ['https://mint.example'] });
    // The hostname belongs to the row that renders it. Stored, it is
    // indistinguishable from a real name and outranks the real one that
    // arrives later.
    expect(resolveProvider(URL, held).name).toBeNull();
  });

  it('treats an empty mint list as silence, not as "accepts any mint"', () => {
    let held = withClaim(undefined, 'self', { mints: ['https://mint.example'] });
    held = withClaim(held, 'aggregator', { mints: [] });
    expect(resolveProvider(URL, held).mints).toEqual(['https://mint.example']);
  });

  it('keeps e2ee: false, because only a catalog read can produce it', () => {
    const held = withClaim(undefined, 'catalog', { e2ee: false });
    expect(resolveProvider(URL, held).e2ee).toBe(false);
  });
});

describe('operator identity', () => {
  it('ignores a peer directory’s claim about who runs a node', () => {
    let held = withClaim(undefined, 'announcement', { pubkey: OPERATOR });
    held = withClaim(held, 'peer', { pubkey: IMPOSTOR });
    expect(resolveProvider(URL, held).pubkey).toBe(OPERATOR);
  });

  it('prefers the node’s own /v1/info over any announcement', () => {
    let held = withClaim(undefined, 'announcement', { pubkey: IMPOSTOR });
    held = withClaim(held, 'self', { pubkey: OPERATOR });
    expect(resolveProvider(URL, held).pubkey).toBe(OPERATOR);
  });

  it('names the sources that claim a different operator', () => {
    let held = withClaim(undefined, 'self', { pubkey: OPERATOR });
    held = withClaim(held, 'announcement', { pubkey: IMPOSTOR });
    expect(contestedPubkeySources(held)).toEqual(['announcement']);
  });

  it('reports no contest when everyone agrees', () => {
    let held = withClaim(undefined, 'self', { pubkey: OPERATOR });
    held = withClaim(held, 'aggregator', { pubkey: OPERATOR });
    expect(contestedPubkeySources(held)).toEqual([]);
  });
});

describe('reference identity', () => {
  it('returns the same record when a source repeats itself', () => {
    const first = withClaim(undefined, 'self', { name: 'Example', mints: ['https://m.example'] });
    const again = withClaim(first, 'self', { name: 'Example', mints: ['https://m.example'] });
    expect(again).toBe(first);
  });

  it('merges within one source, so a partial update cannot erase it', () => {
    // `/v1/info` lands twice: the liveness probe, then the metadata fetch.
    let held = withClaim(undefined, 'self', { name: 'Example', pubkey: OPERATOR });
    held = withClaim(held, 'self', { version: '0.1.3' });
    const resolved = resolveProvider(URL, held);
    expect(resolved.name).toBe('Example');
    expect(resolved.pubkey).toBe(OPERATOR);
    expect(resolved.version).toBe('0.1.3');
  });

  it('returns the same resolved map when a lower-ranked source adds nothing visible', () => {
    const before = { [URL]: withClaim(undefined, 'self', { name: 'Example' }) };
    const resolved = resolveProviders(before, {});
    // A peer repeating the name is news about the network and no news to the
    // user, so no row may re-render for it.
    const after = { [URL]: withClaim(before[URL], 'peer', { name: 'Example' }) };
    expect(resolveProviders(after, resolved)).toBe(resolved);
  });

  it('keeps the untouched rows’ identity when one row changes', () => {
    const other = 'https://other.example';
    const before = {
      [URL]: withClaim(undefined, 'self', { name: 'Example' }),
      [other]: withClaim(undefined, 'self', { name: 'Other' }),
    };
    const resolved = resolveProviders(before, {});
    const after = { ...before, [URL]: withClaim(before[URL], 'self', { version: '2' }) };
    const next = resolveProviders(after, resolved);
    expect(next).not.toBe(resolved);
    expect(next[other]).toBe(resolved[other]);
    expect(next[URL]).not.toBe(resolved[URL]);
  });

  it('does not reuse a stale map when a provider disappears', () => {
    const before = { [URL]: withClaim(undefined, 'self', { name: 'Example' }) };
    const resolved = resolveProviders(before, {});
    expect(resolveProviders({}, resolved)).not.toBe(resolved);
  });
});

describe('an empty record', () => {
  it('resolves to nothing rather than to guesses', () => {
    expect(resolveProvider(URL, record())).toEqual({
      baseUrl: URL,
      name: null,
      description: null,
      version: null,
      pubkey: null,
      mints: [],
      e2ee: null,
    });
  });
});
