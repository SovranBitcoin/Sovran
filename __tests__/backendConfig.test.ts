import { parseBackendConfig } from '@/shared/config/backend';

describe('backend config', () => {
  it('defaults Nostr app-view, score, and GraphQL calls when env is unset', () => {
    expect(parseBackendConfig({})).toEqual({
      nostrAppViewBaseUrl: 'https://nagg.up.railway.app',
      apiBaseUrl: 'https://api.sovran.money/api',
      scoreApiBaseUrl: 'https://nagg.up.railway.app',
      nostrGraphqlEndpoint: 'https://nagg.up.railway.app/graphql',
      nostrDmAppView: false,
      nostrFeedAppView: false,
      nostrNotificationsAppView: false,
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
      nostrGraphqlEndpoint: 'http://localhost:8081/graphql',
      nostrDmAppView: false,
      nostrFeedAppView: false,
      nostrNotificationsAppView: false,
    });
  });

  it('enables the DM app-view transport only when explicitly set to "true"', () => {
    expect(parseBackendConfig({ EXPO_PUBLIC_NOSTR_DM_APPVIEW: 'true' }).nostrDmAppView).toBe(true);
    expect(parseBackendConfig({ EXPO_PUBLIC_NOSTR_DM_APPVIEW: 'false' }).nostrDmAppView).toBe(
      false
    );
    expect(parseBackendConfig({}).nostrDmAppView).toBe(false);
  });

  it('enables the feed app-view transport only when explicitly set to "true"', () => {
    expect(parseBackendConfig({ EXPO_PUBLIC_NOSTR_FEED_APPVIEW: 'true' }).nostrFeedAppView).toBe(
      true
    );
    expect(parseBackendConfig({ EXPO_PUBLIC_NOSTR_FEED_APPVIEW: 'false' }).nostrFeedAppView).toBe(
      false
    );
    expect(parseBackendConfig({}).nostrFeedAppView).toBe(false);
  });

  it('enables the notifications app-view transport only when explicitly set to "true"', () => {
    expect(
      parseBackendConfig({ EXPO_PUBLIC_NOSTR_NOTIFICATIONS_APPVIEW: 'true' })
        .nostrNotificationsAppView
    ).toBe(true);
    expect(
      parseBackendConfig({ EXPO_PUBLIC_NOSTR_NOTIFICATIONS_APPVIEW: 'false' })
        .nostrNotificationsAppView
    ).toBe(false);
    expect(parseBackendConfig({}).nostrNotificationsAppView).toBe(false);
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

  it('rejects invalid Nostr app-view URLs', () => {
    expect(() =>
      parseBackendConfig({
        EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: 'not-a-url',
      })
    ).toThrow(/Invalid backend config/);
  });
});
