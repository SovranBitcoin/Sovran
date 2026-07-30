/**
 * Relay-url tokenization: a `wss://` (or `ws://`) url in note content becomes
 * a `relay` segment (rendered as the inline RelayCard block), while `https://`
 * urls keep their existing `url` classification and garbage stays plain text.
 */
import { parseContent } from '@/features/feed/components/nostr/feedParse';

describe('relay segment tokenization', () => {
  it('tokenizes a wss:// url as a relay segment between text', () => {
    const segments = parseContent('join wss://buzz.cashu.space now');
    expect(segments).toEqual([
      { kind: 'text', text: 'join ' },
      { kind: 'relay', url: 'wss://buzz.cashu.space' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('tokenizes ws:// (plain websocket) relays too', () => {
    const segments = parseContent('local ws://192.168.1.10:7777 relay');
    expect(segments[1]).toEqual({ kind: 'relay', url: 'ws://192.168.1.10:7777' });
  });

  it('leaves https:// urls classified as url, not relay', () => {
    const segments = parseContent('see https://example.com/page');
    expect(segments[1]).toEqual({ kind: 'url', url: 'https://example.com/page' });
  });

  it('keeps an unparseable wss:// fragment as plain text', () => {
    const segments = parseContent('broken wss:// nothing');
    expect(segments.every((s) => s.kind !== 'relay')).toBe(true);
  });

  it('rejects a hostless wss://. match', () => {
    const segments = parseContent('broken wss://. nothing');
    expect(segments.every((s) => s.kind !== 'relay')).toBe(true);
  });

  it('produces one segment per relay url', () => {
    const segments = parseContent('wss://a.example wss://b.example');
    const relays = segments.filter((s) => s.kind === 'relay');
    expect(relays).toEqual([
      { kind: 'relay', url: 'wss://a.example' },
      { kind: 'relay', url: 'wss://b.example' },
    ]);
  });

  it('does not disturb adjacent hashtag tokenization', () => {
    const segments = parseContent('#nostr wss://relay.example.org rocks');
    expect(segments[0]).toEqual({ kind: 'hashtag', tag: 'nostr' });
    expect(segments.some((s) => s.kind === 'relay' && s.url === 'wss://relay.example.org')).toBe(
      true
    );
  });
});
