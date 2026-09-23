/**
 * @jest-environment node
 *
 * The gate that decides what may load inside an embedded WebView. Stricter than
 * `validateExternalUrl`: that one feeds the OS opener and allows mailto:/tel:,
 * this one must refuse everything but http(s), because react-native-webview
 * hands a url it will not load to `Linking.openURL` rather than dropping it.
 */

import { isHttpNavigationUrl } from '@/shared/lib/url';

describe('isHttpNavigationUrl', () => {
  it.each(['https://example.com', 'http://example.com/a?b=1', 'HTTPS://EXAMPLE.COM'])(
    'allows %s',
    (url) => expect(isHttpNavigationUrl(url)).toBe(true)
  );

  it.each([
    ['an android intent', 'intent://scan/#Intent;scheme=zxing;end'],
    ['a local file', 'file:///etc/passwd'],
    ['inline script', 'javascript:alert(1)'],
    ['a dialer link', 'tel:+15551234567'],
    ['a mail link', 'mailto:a@b.com'],
    ['our own deep link', 'sovran://pay?amount=1'],
    ['a data payload', 'data:text/html,<script>'],
    ['unparseable input', 'not a url'],
    ['an empty string', ''],
  ])('refuses %s', (_label, url) => expect(isHttpNavigationUrl(url)).toBe(false));

  it('refuses nullish input', () => {
    expect(isHttpNavigationUrl(undefined)).toBe(false);
    expect(isHttpNavigationUrl(null)).toBe(false);
  });
});
