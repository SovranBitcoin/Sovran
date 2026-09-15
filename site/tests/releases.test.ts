import { describe, expect, test } from 'bun:test';
import { channels, fetchAvailability, parseAvailability } from '../src/lib/releases';

function fixture() {
  return { schemaVersion: 1, channels: {
    appStore: { version: '1.0.0', build: '1', url: 'https://apps.apple.com/app/id6499554529' },
    freedomStore: { version: '2.0.0', build: '2', url: 'https://freedomstore.io' },
    googlePlay: { version: '3.0.0', build: '3', url: 'https://play.google.com/store/apps/details?id=com.sovranbitcoin' },
    githubApk: { version: '4.0.0', build: '4', url: 'https://github.com/SovranBitcoin/Sovran/releases/download/v4.0.0/sovran-4.0.0.apk' },
    zapstore: { version: '5.0.0', build: '5', url: 'https://zapstore.dev/apps/com.sovranbitcoin' },
  } };
}
describe('publisher trust boundary', () => {
  test('keeps five independent versions, never a global latest', () => {
    const result = parseAvailability(fixture());
    expect(channels.map((channel) => result[channel]?.version)).toEqual(['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']);
  });
  test('accepts explicitly unavailable channels', () => {
    expect(parseAvailability({ schemaVersion: 1, channels: Object.fromEntries(channels.map((channel) => [channel, null])) })).toEqual(Object.fromEntries(channels.map((channel) => [channel, null])));
  });
  for (const input of [null, [], {}, { schemaVersion: 2, channels: {} }, { schemaVersion: 1, channels: {} }]) {
    test(`rejects unknown envelope ${JSON.stringify(input)}`, () => expect(() => parseAvailability(input)).toThrow());
  }
  for (const url of [
    'http://apps.apple.com/app/id6499554529', 'javascript:alert(1)',
    'https://apps.apple.com.evil.example/app/id6499554529', 'https://apps.apple.com@evil.example/app/id6499554529',
    'https://user:pass@apps.apple.com/app/id6499554529', 'https://apps.apple.com:444/app/id6499554529',
    'https://apps.apple.com:443/app/id6499554529', 'https://apps.apple.com/app/id6499554529#x',
    'https://apps.apple.com/app/id6499554529?redirect=evil', 'https://apps.apple.com/app/id111',
    'https://apps.apple.com/other/../app/id6499554529', ' https://apps.apple.com/app/id6499554529',
  ]) {
    test(`rejects destination substitution ${url}`, () => {
      const input = fixture(); input.channels.appStore.url = url;
      expect(() => parseAvailability(input)).toThrow();
    });
  }
  for (const channel of channels) {
    test(`${channel} cannot use another channel destination or unknown version`, () => {
      const input = fixture(); input.channels[channel].url = 'https://evil.example/download';
      expect(() => parseAvailability(input)).toThrow();
      const unknown = fixture(); Reflect.set(unknown.channels[channel], 'version', null);
      expect(() => parseAvailability(unknown)).toThrow();
      Reflect.set(unknown.channels[channel], 'version', '1.0.0'); Reflect.set(unknown.channels[channel], 'build', null);
      expect(() => parseAvailability(unknown)).toThrow();
    });
  }
  test('APK filename and tag must match that channel version and exact publisher', () => {
    for (const url of ['https://github.com/attacker/Sovran/releases/download/v4.0.0/sovran-4.0.0.apk', 'https://github.com/SovranBitcoin/Sovran/releases/download/v4.0.0/sovran-5.0.0.apk']) {
      const input = fixture(); input.channels.githubApk.url = url;
      expect(() => parseAvailability(input)).toThrow();
    }
  });
  test('rejects malformed publisher integrity fields', () => {
    for (const [field, value] of [['sha256', 'bad'], ['certificateSha256', 'bad'], ['sourceSha', 'bad'], ['confirmedAt', 'yesterday'], ['confirmedAt', '2026-02-30T00:00:00.000Z'], ['size', -1]]) {
      const input = fixture(); Reflect.set(input.channels.githubApk, field, value);
      expect(() => parseAvailability(input)).toThrow();
    }
  });
  test('accepts publisher integrity fields without claiming byte verification', () => {
    const input = fixture(); Object.assign(input.channels.githubApk, { sha256: 'a'.repeat(64), certificateSha256: 'b'.repeat(64), sourceSha: 'c'.repeat(40), confirmedAt: '2026-09-12T17:26:46.634Z', size: 1234 });
    expect(parseAvailability(input).githubApk?.sha256).toBe('a'.repeat(64));
  });
  test('does not accept inherited channels', () => expect(() => parseAvailability({ schemaVersion: 1, channels: Object.create(fixture().channels) })).toThrow());
});

describe('runtime only fetch', () => {
  test('uses bounded, credential-free, no-cache, no-redirect fetch', async () => {
    let options: RequestInit | undefined;
    const fetcher: typeof fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('/releases/channels.json'); options = init;
      return Response.json(fixture());
    }, { preconnect() {} });
    expect((await fetchAvailability(fetcher)).zapstore?.version).toBe('5.0.0');
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
  });
  for (const [label, response] of [
    ['HTTP failure', new Response('{}', { status: 503 })],
    ['SPA fallback', new Response('<html>home</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['invalid JSON', new Response('{', { headers: { 'Content-Type': 'application/json' } })],
    ['oversized JSON', new Response(' '.repeat(100001), { headers: { 'Content-Type': 'application/json' } })],
    ['unknown channels', Response.json({ schemaVersion: 1, channels: {} })],
  ] as const) {
    test(`fails closed on ${label}`, async () => {
      const fetcher = Object.assign(async () => response.clone(), { preconnect() {} });
      await expect(fetchAvailability(fetcher)).rejects.toThrow();
    });
  }
  test('network rejection cannot return a bundled snapshot', async () => {
    const fetcher = Object.assign(async () => { throw new Error('offline'); }, { preconnect() {} });
    await expect(fetchAvailability(fetcher)).rejects.toThrow('offline');
  });
  test('aborts a rejected content-type response instead of leaving its body downloading', async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = Object.assign(async (_url: string | URL | Request, options?: RequestInit) => {
      signal = options?.signal;
      return new Response('not JSON', { headers: { 'Content-Type': 'text/html' } });
    }, { preconnect() {} });
    await expect(fetchAvailability(fetcher)).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
  });
});
