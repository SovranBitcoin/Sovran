import { parseBackendConfig } from '@/shared/config/backend';

describe('backend config', () => {
  it('defaults Nostr app-view, score, and GraphQL calls when env is unset', () => {
    expect(parseBackendConfig({})).toEqual({
      nostrAppViewBaseUrl: 'https://nagg-production.up.railway.app',
      apiBaseUrl: 'https://api.sovran.money/api',
      scoreApiBaseUrl: 'https://nagg-production.up.railway.app',
      mintAppViewBaseUrl: 'https://nagg-production.up.railway.app',
      nostrGraphqlEndpoint: 'https://nagg-production.up.railway.app/graphql',
      primalCacheUrl: 'wss://cache2.primal.net/v1',
    });
  });

  it('normalizes custom backend URLs and lets score and GraphQL calls move independently', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'http://localhost:8080/',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test/api/',
        EXPO_PUBLIC_SCORE_API_BASE_URL: 'http://localhost:8080/',
        EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: 'http://localhost:8081/graphql/',
      })
    ).toEqual({
      nostrAppViewBaseUrl: 'http://localhost:8080',
      apiBaseUrl: 'https://api.example.test/api',
      scoreApiBaseUrl: 'http://localhost:8080',
      mintAppViewBaseUrl: 'http://localhost:8080',
      nostrGraphqlEndpoint: 'http://localhost:8081/graphql',
      primalCacheUrl: 'wss://cache2.primal.net/v1',
    });
  });

  // The mint routes can be served by a nagg running NAGG_MODULES=mint — the
  // observatory alone, on a fraction of the ClickHouse — while /app/* and
  // /nostr/profile stay on the full app-view. Unset must change nothing.
  it('moves only the mint routes when the mint app-view URL is set', () => {
    const config = parseBackendConfig({
      EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'https://nagg.example.test',
      EXPO_PUBLIC_MINT_APPVIEW_BASE_URL: 'https://nagg-mint.example.test/',
    });
    expect(config.mintAppViewBaseUrl).toBe('https://nagg-mint.example.test');
    expect(config.scoreApiBaseUrl).toBe('https://nagg.example.test');
    expect(config.nostrAppViewBaseUrl).toBe('https://nagg.example.test');
  });

  it('falls the mint app-view back to the score API host', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'https://nagg.example.test',
        EXPO_PUBLIC_SCORE_API_BASE_URL: 'https://scores.example.test',
      }).mintAppViewBaseUrl
    ).toBe('https://scores.example.test');
  });

  it('keeps the legacy Nagg base URL env as an app-view fallback', () => {
    expect(
      parseBackendConfig({
        EXPO_PUBLIC_NAGG_BASE_URL: 'https://legacy-nagg.example.test',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test/api',
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
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test/api',
      }).scoreApiBaseUrl
    ).toBe('https://nostr-index.example.test');
  });

  it('defaults the Primal cache URL and honors an override', () => {
    expect(parseBackendConfig({}).primalCacheUrl).toBe('wss://cache2.primal.net/v1');
    expect(
      parseBackendConfig({ EXPO_PUBLIC_PRIMAL_CACHE_URL: 'wss://my-cache.example/v1' })
        .primalCacheUrl
    ).toBe('wss://my-cache.example/v1');
  });

  it('rejects invalid Nostr app-view URLs', () => {
    expect(() =>
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'not-a-url',
      })
    ).toThrow(/Invalid backend config/);
  });
});
