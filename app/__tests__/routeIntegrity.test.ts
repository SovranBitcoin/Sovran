/**
 * Every place that names a route must name one that exists under `app/app`.
 * A tab, redirect, native-harness alias or `Stack.Screen` left behind after its
 * route file is deleted navigates to +not-found (or warns at layout mount),
 * and nothing else notices.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  configureEnabledPaymentMethods: jest.fn(),
}));

import { MODAL_SCREENS } from '@/config/modalScreens';
import { PAGE_ROUTES } from '@/e2e/schema/page-routes';

const APP_DIR = join(__dirname, '..');
const ROUTES_DIR = join(APP_DIR, 'app');

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** A screen `name` inside `dir` is a `<name>.tsx` file or a `<name>/` folder of routes. */
function screenExists(dir: string, name: string): boolean {
  return isFile(join(dir, `${name}.tsx`)) || isDir(join(dir, name));
}

/** A URL path resolves to a route file, its folder's `index.tsx`, or a group's `_layout.tsx`. */
function pathExists(path: string): boolean {
  const base = join(ROUTES_DIR, path.replace(/^\//, ''));
  return (
    isFile(`${base}.tsx`) || isFile(join(base, 'index.tsx')) || isFile(join(base, '_layout.tsx'))
  );
}

const TABS_DIR = join(ROUTES_DIR, '(drawer)', '(tabs)');

describe('route integrity', () => {
  it('every tab is a folder with a stack and a root page, Search last', () => {
    const layout = readFileSync(join(TABS_DIR, '_layout.tsx'), 'utf8');
    const names = [...layout.matchAll(/^ {4}name: '([^']+)',$/gm)].map((match) => match[1]);
    expect(names).toEqual(['index', 'settings', 'search']);
    const missing = names.filter(
      (name) =>
        !isFile(join(TABS_DIR, name, '_layout.tsx')) || !isFile(join(TABS_DIR, name, 'index.tsx'))
    );
    expect(missing).toEqual([]);
    // No folder is left behind as an undeclared tab (the old Contacts tab).
    const folders = readdirSync(TABS_DIR).filter((entry) => isDir(join(TABS_DIR, entry)));
    expect(folders.sort()).toEqual([...names].sort());
  });

  it('every Redirect names an existing route', () => {
    const redirect = readFileSync(join(ROUTES_DIR, '(settings-flow)', 'index.tsx'), 'utf8');
    const href = redirect.match(/<Redirect href="([^"]+)"/)?.[1];
    expect(href).toBe('/(drawer)/(tabs)/settings');
    expect(pathExists(href!)).toBe(true);
  });

  it('every PAGE_ROUTES alias is an existing route file', () => {
    const targets = Object.values(PAGE_ROUTES).flatMap((routes) => routes ?? []);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !isFile(join(ROUTES_DIR, target)))).toEqual([]);
  });

  it('every Stack.Screen in a group layout names an existing route', () => {
    const groups = readdirSync(ROUTES_DIR).filter(
      (entry) => /^\(.+\)$/.test(entry) && isFile(join(ROUTES_DIR, entry, '_layout.tsx'))
    );
    expect(groups.length).toBeGreaterThan(0);
    const missing: string[] = [];
    let checked = 0;
    for (const group of groups) {
      const dir = join(ROUTES_DIR, group);
      const layout = readFileSync(join(dir, '_layout.tsx'), 'utf8');
      for (const [, name] of layout.matchAll(/<(?:\w+\.)?Screen\s+[^>]*?\bname="([^"]+)"/g)) {
        checked += 1;
        if (!screenExists(dir, name)) missing.push(`${group}/${name}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('every root Stack.Screen names an existing route', () => {
    const layout = readFileSync(join(ROUTES_DIR, '_layout.tsx'), 'utf8');
    const literal = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
    const names = [...MODAL_SCREENS.map((screen) => screen.name), ...literal];
    expect(names.length).toBeGreaterThan(1);
    expect(names.filter((name) => !screenExists(ROUTES_DIR, name))).toEqual([]);
  });
});
