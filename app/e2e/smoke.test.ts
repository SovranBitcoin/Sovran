import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isCanonicalPage } from './schema/pages';
import { PAGE_ROUTES } from './schema/page-routes';
import { CORE_WALLET_SCREENS } from './smoke.mjs';

describe('lean visual-parity smoke runner', () => {
  test('every core wallet screen is registered in CANONICAL_PAGES and PAGE_ROUTES', () => {
    expect(CORE_WALLET_SCREENS.length).toBeGreaterThanOrEqual(6);
    for (const screen of CORE_WALLET_SCREENS) {
      expect(isCanonicalPage(screen.page)).toBe(true);
      const routes = PAGE_ROUTES[screen.page as keyof typeof PAGE_ROUTES];
      expect(routes && routes.length > 0).toBe(true);
      expect(screen.url.startsWith('sovran://')).toBe(true);
    }
  });

  test('--plan prints the capture plan without requiring a simulator', () => {
    const script = resolve(import.meta.dir, 'smoke.mjs');
    const stdout = execFileSync('node', [script, '--plan', '--platform', 'ios', '--mode', 'both'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.platform).toBe('ios');
    expect(parsed.appearances).toEqual(['light', 'dark']);
    expect(parsed.screens.length).toBe(CORE_WALLET_SCREENS.length);
  });
});
