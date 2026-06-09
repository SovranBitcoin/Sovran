import { test, expect, describe } from 'bun:test';

import { isReady } from '../deploy-gate.mjs';

describe('isReady', () => {
  test('rejects the SPA fallback (200 text/html)', () => {
    expect(isReady({ status: 200, contentType: 'text/html', bytes: 842 }, 'json', 47093)).toBe(
      false
    );
    expect(isReady({ status: 200, contentType: 'text/html', bytes: 842 }, 'image')).toBe(false);
  });

  test('accepts a real image', () => {
    expect(isReady({ status: 200, contentType: 'image/png', bytes: 1000 }, 'image')).toBe(true);
  });

  test('json requires content-type json and matching bytes', () => {
    expect(
      isReady({ status: 200, contentType: 'application/json', bytes: 47093 }, 'json', 47093)
    ).toBe(true);
    expect(
      isReady({ status: 200, contentType: 'application/json', bytes: 10 }, 'json', 47093)
    ).toBe(false);
    expect(isReady({ status: 200, contentType: 'application/json', bytes: 10 }, 'json')).toBe(true);
  });

  test('non-200 is never ready', () => {
    expect(isReady({ status: 404, contentType: 'text/html', bytes: 0 }, 'image')).toBe(false);
    expect(isReady({ status: 0, contentType: '', bytes: 0 }, 'image')).toBe(false);
  });
});
