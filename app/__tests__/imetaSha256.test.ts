/**
 * parseImetaTags exposes the Blossom content address (`x`) so the delete flow
 * can target the right blob without parsing it out of the (lossy) URL.
 */
import { parseImetaTags } from '@/features/feed/components/nostr/feedParse';

describe('parseImetaTags sha256 (x field)', () => {
  it('extracts the x field as sha256', () => {
    const map = parseImetaTags([['imeta', 'url https://b/abc.jpg', 'x deadbeef', 'm image/jpeg']]);
    expect(map.get('https://b/abc.jpg')?.sha256).toBe('deadbeef');
  });

  it('leaves sha256 undefined when the imeta tag has no x field', () => {
    const map = parseImetaTags([['imeta', 'url https://b/x.jpg', 'm image/jpeg']]);
    expect(map.get('https://b/x.jpg')?.sha256).toBeUndefined();
  });
});
