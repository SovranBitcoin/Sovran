import { parseBackendConfig } from '@/shared/config/backend';

describe('backend config', () => {
  it('defaults the Primal cache URLs and honors an override', () => {
    expect(parseBackendConfig({})).toEqual({
      primalCacheUrls: ['wss://cache1.primal.net/v1', 'wss://cache2.primal.net/v1'],
    });
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

  it('rejects invalid Primal cache URLs', () => {
    expect(() =>
      parseBackendConfig({
        EXPO_PUBLIC_PRIMAL_CACHE_URL: 'not-a-url',
      })
    ).toThrow(/Invalid backend config/);
  });
});
