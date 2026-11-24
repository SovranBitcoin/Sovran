/**
 * Every place that names a route must name one that exists under `app/app`.
 * A drawer row, native-harness alias or `Stack.Screen` left behind after its
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
import { drawerMenuItems } from '@/navigation/drawerMenu';

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

/** Every `MenuRoute` in the union, read from its declaration. */
function menuRouteUnion(): string[] {
  const source = readFileSync(join(APP_DIR, 'navigation', 'drawerMenu.ts'), 'utf8');
  const declaration = source.match(/export type MenuRoute =([\s\S]*?);/);
  if (!declaration) throw new Error('MenuRoute declaration not found');
  const members = declaration[1].replace(/\/\/.*$/gm, '');
  return [...members.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** Wallet is `(tabs)/index`, which expo-router collapses to the root path. */
const WALLET_ROUTE_FILE = '(drawer)/(tabs)/index/index.tsx';

describe('route integrity', () => {
  it('every MenuRoute and drawer row names an existing route', () => {
    const routes = new Set([
      ...menuRouteUnion(),
      ...drawerMenuItems(() => true).map((i) => i.route),
    ]);
    expect(menuRouteUnion()).toContain('/(settings-flow)');
    expect(routes.size).toBeGreaterThan(1);
    const missing = [...routes].filter((route) =>
      route === '/' ? !isFile(join(ROUTES_DIR, WALLET_ROUTE_FILE)) : !pathExists(route)
    );
    expect(missing).toEqual([]);
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
