/**
 * @jest-environment node
 *
 * The scheme gate for image URLs that arrive in third-party metadata — a mint's
 * NIP-11 `icon_url`, a Nostr kind-0 `picture`. `prefetchImage` has always used
 * it; the render paths did not, so this pins both sides to the same predicate.
 */

import { isSafeImageUrl } from '@/shared/lib/imageCache';

describe('isSafeImageUrl', () => {
  it.each(['https://mint.example/icon.png', 'http://self-hosted.example/logo.png'])(
    'allows %s',
    (url) => expect(isSafeImageUrl(url)).toBe(true)
  );

  it.each([
    ['a local file', 'file:///etc/passwd'],
    ['an inline payload', 'data:image/png;base64,AAAA'],
    ['inline script', 'javascript:alert(1)'],
    ['a custom app scheme', 'sovran://pay'],
    ['unparseable input', 'not a url'],
    ['an empty string', ''],
  ])('refuses %s', (_label, url) => expect(isSafeImageUrl(url)).toBe(false));
});
