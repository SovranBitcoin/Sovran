import { avatarStateFor, profileAvatarStateFor } from '@/shared/lib/imageLoadState';

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

describe('profileAvatarStateFor', () => {
  it.each([
    [undefined, 'loading', 'loading'],
    ['', 'loading', 'loading'],
    [undefined, 'cached', 'fallback'],
    [undefined, 'absent', 'fallback'],
    ['real.png', 'loading', 'image'],
    ['real.png', 'cached', 'image'],
  ] as const)('picture=%j status=%s → %s', (picture, status, expected) => {
    expect(profileAvatarStateFor(picture, status)).toBe(expected);
  });
});
