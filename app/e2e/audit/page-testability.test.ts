import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_ROUTES } from '../schema/page-routes';
import { isCanonicalPage } from '../schema/pages';

function pageRoutes(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return pageRoutes(join(directory, entry.name), path + '/');
    if (
      !entry.name.endsWith('.tsx') ||
      ['_layout.tsx', '+html.tsx', '+native-intent.tsx'].includes(entry.name)
    )
      return [];
    return [path];
  });
}

test('every native route has an explicit canonical page including modal aliases', () => {
  const registered = Object.values(PAGE_ROUTES).flat();
  expect(new Set(registered).size).toBe(registered.length);
  expect([...registered].sort()).toEqual(pageRoutes(join(import.meta.dir, '../../app')).sort());
  expect(Object.keys(PAGE_ROUTES).every(isCanonicalPage)).toBe(true);
});
