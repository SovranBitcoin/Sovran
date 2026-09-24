import { parseBackendConfig } from '@/shared/config/backend';

describe('backend config', () => {
  it('defaults Nostr app-view, score, and GraphQL calls when env is unset', () => {
    expect(parseBackendConfig({})).toEqual({
      nostrAppViewBaseUrl: 'https://nagg.up.railway.app',
      scoreApiBaseUrl: 'https://nagg.up.railway.app',
      nostrGraphqlEndpoint: 'https://nagg.up.railway.app/graphql',
      primalCacheUrls: ['wss://cache1.primal.net/v1', 'wss://cache2.primal.net/v1'],
    });
  });

  it('normalizes custom backend URLs and lets score and GraphQL calls move independently', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'http://localhost:8080/',
        EXPO_PUBLIC_SCORE_API_BASE_URL: 'http://localhost:8080/',
        EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: 'http://localhost:8081/graphql/',
      })
    ).toEqual({
      nostrAppViewBaseUrl: 'http://localhost:8080',
      scoreApiBaseUrl: 'http://localhost:8080',
      nostrGraphqlEndpoint: 'http://localhost:8081/graphql',
      primalCacheUrls: ['wss://cache1.primal.net/v1', 'wss://cache2.primal.net/v1'],
    });
  });

  it('keeps the legacy Nagg base URL env as an app-view fallback', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NAGG_BASE_URL: 'https://legacy-nagg.example.test',
      })
    ).toMatchObject({
      nostrAppViewBaseUrl: 'https://legacy-nagg.example.test',
      nostrGraphqlEndpoint: 'https://legacy-nagg.example.test/graphql',
    });
  });

  it('defaults score calls to the configured Nostr app-view base URL', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'https://nostr-index.example.test',
      }).scoreApiBaseUrl
    ).toBe('https://nostr-index.example.test');
  });

  it('defaults the Primal cache URLs and honors an override', () => {
    // A list, tried in order: cache1 first because cache2 was the host that went
    // down on 2026-09-24 while cache1 kept serving.
    expect(parseBackendConfig({}).primalCacheUrls).toEqual([
      'wss://cache1.primal.net/v1',
      'wss://cache2.primal.net/v1',
    ]);
    expect(
      parseBackendConfig({ EXPO_PUBLIC_PRIMAL_CACHE_URL: 'wss://my-cache.example/v1' })
        .primalCacheUrls
    ).toEqual(['wss://my-cache.example/v1']);
  });

  it('splits a comma-separated Primal override into an ordered list', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_PRIMAL_CACHE_URL: 'wss://a.example/v1, wss://b.example/v1 ,',
      }).primalCacheUrls
    ).toEqual(['wss://a.example/v1', 'wss://b.example/v1']);
  });

  it('rejects invalid Nostr app-view URLs', () => {
    expect(() =>
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'not-a-url',
      })
    ).toThrow(/Invalid backend config/);
  });
});
