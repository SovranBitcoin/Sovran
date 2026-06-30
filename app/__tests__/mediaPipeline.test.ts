/**
 * Pure media-pipeline logic: imeta tag construction, Blossom auth event shape,
 * sha256 content addressing, and Authorization header encoding.
 */
import { buildImetaTag, buildImetaTags } from '@/shared/lib/nostr/media/imeta';
import {
  BLOSSOM_AUTH_KIND,
  buildBlossomAuthEvent,
  encodeAuthHeader,
  sha256Hex,
} from '@/shared/lib/nostr/media/blossomAuth';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

const FULL: MediaDescriptor = {
  url: 'https://cdn.example/abc.jpg',
  sha256: 'deadbeef',
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
  alt: 'a cat',
};

describe('imeta', () => {
  it('builds a full imeta tag in NIP-92 order', () => {
    expect(buildImetaTag(FULL)).toEqual([
      'imeta',
      'url https://cdn.example/abc.jpg',
      'm image/jpeg',
      'dim 800x600',
      'x deadbeef',
      'alt a cat',
    ]);
  });

  it('omits absent fields', () => {
    const tag = buildImetaTag({ url: 'https://x/y.png', sha256: '', mimeType: 'image/png' });
    expect(tag).toEqual(['imeta', 'url https://x/y.png', 'm image/png']);
  });

  it('builds one tag per descriptor', () => {
    expect(buildImetaTags([FULL, FULL])).toHaveLength(2);
  });
});

describe('blossom auth', () => {
  it('builds a kind:24242 upload auth with t/x/expiration tags', () => {
    const event = buildBlossomAuthEvent({ action: 'upload', sha256: 'abc123', createdAt: 1000 });
    expect(event.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(event.tags).toEqual([
      ['t', 'upload'],
      ['x', 'abc123'],
      ['expiration', '1300'], // createdAt + 5m default
    ]);
  });

  it('honors an explicit expiration', () => {
    const event = buildBlossomAuthEvent({
      action: 'upload',
      sha256: 'x',
      createdAt: 1000,
      expirationSec: 2000,
    });
    expect(event.tags).toContainEqual(['expiration', '2000']);
  });

  it('encodes a Nostr base64 Authorization header', () => {
    const header = encodeAuthHeader('{"kind":24242}');
    expect(header.startsWith('Nostr ')).toBe(true);
    const decoded = Buffer.from(header.slice('Nostr '.length), 'base64').toString('utf-8');
    expect(decoded).toBe('{"kind":24242}');
  });
});

describe('sha256Hex', () => {
  it('hashes empty input to the known vector', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('hashes "abc" to the known vector', () => {
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
