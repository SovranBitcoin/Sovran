import { relayBrandForSoftware } from '@/features/feed/components/nostr/relayBrands';

describe('relayBrandForSoftware', () => {
  it('matches a known software URL regardless of case and trailing slash', () => {
    expect(relayBrandForSoftware(' https://GitHub.com/block/buzz/ ')?.label).toBe('Buzz');
  });

  it('returns undefined for unknown and missing software', () => {
    expect(relayBrandForSoftware('https://example.com/relay')).toBeUndefined();
    expect(relayBrandForSoftware(undefined)).toBeUndefined();
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'does not brand a relay advertising software %s',
    (software) => {
      expect(relayBrandForSoftware(software)).toBeUndefined();
    }
  );
});
