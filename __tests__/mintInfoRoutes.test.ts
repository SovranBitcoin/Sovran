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
