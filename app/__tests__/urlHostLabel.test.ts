/**
 * Settings names saved servers by host. A value an older release saved that
 * does not parse must still render: `new URL` on it used to take Settings down.
 */
import { urlHostLabel } from '@/shared/lib/url';

jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return { log: { ...sink, child: () => sink }, cashuLog: sink, storeLog: sink, apiLog: sink };
});

describe('urlHostLabel', () => {
  it.each([
    ['https://blossom.primal.net/', 'blossom.primal.net'],
    ['wss://cache1.primal.net/v1', 'cache1.primal.net'],
    ['https://media.example:8443/up', 'media.example:8443'],
  ])('names %s by its host', (url, host) => {
    expect(urlHostLabel(url)).toBe(host);
  });

  it.each([
    'blossom.primal.net',
    'not a url',
    '',
    'https://',
    'https://exa mple.com',
    'http://[::1',
  ])('never throws on the malformed saved value %p', (url) => {
    expect(() => urlHostLabel(url)).not.toThrow();
    expect(typeof urlHostLabel(url)).toBe('string');
  });

  it('shows a malformed value without its scheme', () => {
    expect(urlHostLabel('https://exa mple.com')).toBe('exa mple.com');
  });
});
