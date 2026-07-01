/**
 * Owned-blob extraction: blossom-url detection, imeta + content-url sources,
 * dedup by sha256 (imeta wins for mime), and descriptor mapping.
 */
import {
  blossomSha256FromUrl,
  extractOwnedBlobs,
  extractOwnedBlobsFromDescriptors,
} from '@/shared/lib/nostr/media/ownedBlobs';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function evt(tags: string[][], content = ''): FeedEvent {
  return { id: 'n1', kind: 1, pubkey: 'p', content, tags, created_at: 0 };
}

describe('blossomSha256FromUrl', () => {
  it('returns the hash for blossom-shaped urls (bare, ext, query)', () => {
    expect(blossomSha256FromUrl(`https://b/${SHA_A}.jpg`)).toBe(SHA_A);
    expect(blossomSha256FromUrl(`https://b/${SHA_A}`)).toBe(SHA_A);
    expect(blossomSha256FromUrl(`https://b/${SHA_A}.png?x=1`)).toBe(SHA_A);
  });

  it('returns null for non-blossom urls', () => {
    expect(blossomSha256FromUrl('https://example.com/photo.jpg')).toBeNull();
    expect(blossomSha256FromUrl('https://b/not-a-hash')).toBeNull();
    expect(blossomSha256FromUrl('not a url')).toBeNull();
  });
});

describe('extractOwnedBlobs', () => {
  it('extracts imeta blobs with sha256 + mime + host', () => {
    const blobs = extractOwnedBlobs(
      evt([['imeta', `url https://b/${SHA_A}.jpg`, `x ${SHA_A}`, 'm image/jpeg']])
    );
    expect(blobs).toEqual([
      { sha256: SHA_A, url: `https://b/${SHA_A}.jpg`, host: 'https://b', mimeType: 'image/jpeg' },
    ]);
  });

  it('extracts blossom-shaped content urls without imeta', () => {
    const blobs = extractOwnedBlobs(evt([], `look https://b/${SHA_B}.png here`));
    expect(blobs).toEqual([{ sha256: SHA_B, url: `https://b/${SHA_B}.png`, host: 'https://b' }]);
  });

  it('ignores non-blossom content urls', () => {
    expect(extractOwnedBlobs(evt([], 'see https://example.com/x.jpg'))).toEqual([]);
  });

  it('dedups by sha256 — the imeta entry (with mime) wins', () => {
    const blobs = extractOwnedBlobs(
      evt(
        [['imeta', `url https://b/${SHA_A}.jpg`, `x ${SHA_A}`, 'm image/jpeg']],
        `https://b/${SHA_A}.jpg`
      )
    );
    expect(blobs).toHaveLength(1);
    expect(blobs[0].mimeType).toBe('image/jpeg');
  });
});

describe('extractOwnedBlobsFromDescriptors', () => {
  it('maps descriptors to owned blobs, deduped by sha256', () => {
    const d: MediaDescriptor = {
      url: `https://b/${SHA_A}.jpg`,
      sha256: SHA_A,
      mimeType: 'image/jpeg',
    };
    const blobs = extractOwnedBlobsFromDescriptors([d, d]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toMatchObject({ sha256: SHA_A, host: 'https://b', mimeType: 'image/jpeg' });
  });
});
