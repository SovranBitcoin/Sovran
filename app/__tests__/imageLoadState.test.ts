import { avatarStateFor } from '@/shared/lib/imageLoadState';

describe('avatarStateFor', () => {
  it.each([
    // not looked yet → neutral placeholder, never the silhouette
    [undefined, false, 'loading'],
    [null, false, 'loading'],
    ['', false, 'loading'],
    // settled with no picture → colour placeholder
    [undefined, true, 'fallback'],
    ['', true, 'fallback'],
    // a URL always paints the image (its own load state lives in Avatar)
    ['https://x/a.png', false, 'image'],
    ['https://x/a.png', true, 'image'],
  ])('picture=%j resolved=%j → %s', (picture, resolved, expected) => {
    expect(avatarStateFor(picture, resolved)).toBe(expected);
  });
});
