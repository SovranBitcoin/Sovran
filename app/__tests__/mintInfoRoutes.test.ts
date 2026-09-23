import { buildMintInfoHref, getProfileMintInfoUrl } from '@/shared/lib/nav/mintInfoRoutes';

describe('mint info routes', () => {
  it('builds a string-only route param for Android native navigation', () => {
    const href = buildMintInfoHref('https://mint.example.com');

    expect(href).toEqual({
      pathname: '/(mint-flow)/info',
      params: {
        mintInfoEntry: '{"mintUrl":"https://mint.example.com"}',
      },
    });
    expect(typeof href.params.mintInfoEntry).toBe('string');
  });

  it("carries the caller's on-screen name, icon and score so the page need not refetch them", () => {
    const href = buildMintInfoHref('https://mint.example.com', {
      displayName: 'Example Mint',
      iconUrl: 'https://mint.example.com/icon.png',
      kymScore: 4.6,
      reviewCount: 12,
    });

    expect(JSON.parse(href.params.mintInfoEntry)).toEqual({
      mintUrl: 'https://mint.example.com',
      seedDisplayName: 'Example Mint',
      seedIconUrl: 'https://mint.example.com/icon.png',
      seedKymScore: 4.6,
      seedReviewCount: 12,
    });
  });

  it('seeds under `seed*` keys, never the canonical ones', () => {
    // The bridge triggers its NUT-06 fetch on `!current.displayName`; seeding
    // that key would suppress the fetch and the page would never receive
    // `contact`, `description`, `motd` or the trust flag.
    const entry = JSON.parse(
      buildMintInfoHref('https://mint.example.com', { displayName: 'Example Mint' }).params
        .mintInfoEntry
    );
    expect(entry.displayName).toBeUndefined();
    expect(entry.iconUrl).toBeUndefined();
    expect(entry.kymScore).toBeUndefined();
    expect(entry.seedDisplayName).toBe('Example Mint');
  });

  it('omits absent seed fields rather than writing nulls into the param', () => {
    const entry = JSON.parse(
      buildMintInfoHref('https://mint.example.com', { kymScore: 3 }).params.mintInfoEntry
    );
    expect(Object.keys(entry).sort()).toEqual(['mintUrl', 'seedKymScore']);
  });

  it('prefers a non-empty profile mint URL and falls back to the route mint URL', () => {
    expect(getProfileMintInfoUrl('https://profile.example.com', 'https://route.example.com')).toBe(
      'https://profile.example.com'
    );
    expect(getProfileMintInfoUrl('', 'https://route.example.com')).toBe(
      'https://route.example.com'
    );
    expect(
      getProfileMintInfoUrl({ mintUrl: 'https://bad.example.com' }, 'https://route.example.com')
    ).toBe('https://route.example.com');
  });
});
