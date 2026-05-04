/**
 * Pure validator behind `openExternalUrl`. Locks the scheme allowlist so a
 * regression that lets `javascript:` / `file:` / `intent:` reach the native
 * opener fails this test, not user devices.
 */

import { validateExternalUrl } from '@/shared/lib/url';

describe('validateExternalUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1',
    'mailto:hello@example.com',
    'tel:+15551234567',
  ])('accepts allowed scheme: %s', (raw) => {
    const r = validateExternalUrl(raw);
    expect(r.isOk()).toBe(true);
  });

  it.each([
    ['javascript:alert(1)', 'javascript:'],
    ['file:///etc/passwd', 'file:'],
    ['data:text/html,<script>', 'data:'],
    ['intent://x#Intent;end', 'intent:'],
    ['ftp://example.com/file', 'ftp:'],
  ])('rejects disallowed scheme: %s', (raw, scheme) => {
    const r = validateExternalUrl(raw);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toEqual({ type: 'unsupported-scheme', scheme });
    }
  });

  it.each(['', 'not a url', '://no-scheme'])('rejects unparseable input: %s', (raw) => {
    const r = validateExternalUrl(raw);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.type === 'invalid-url' || r.error.type === 'unsupported-scheme').toBe(true);
    }
  });
});
