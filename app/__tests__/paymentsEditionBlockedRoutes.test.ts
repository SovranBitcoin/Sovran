/** @jest-environment node */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { resolveFeatureSet } from '@/shared/config/features';
import { disabledFeatureForRoute } from '@/shared/lib/nav/featureRoutes';

const ROUTES_ROOT = join(__dirname, '..', 'app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /\.tsx$/.test(name) && !name.startsWith('_') && !name.startsWith('+') ? [path] : [];
  });
}

/** `app/(x-flow)/thing.tsx` → `['(x-flow)', 'thing']`, as `useSegments` reports it. */
const segmentsOf = (file: string) =>
  relative(ROUTES_ROOT, file)
    .replace(/\.tsx$/, '')
    .split('/');

it('the payments edition turns away exactly the screens of the modules it leaves out', () => {
  // A screen the edition still links to must never be on this list: the guard
  // answers a blocked route by sending the person to the wallet home, which
  // reads as a button that does the wrong thing. The transaction filters were
  // once filed under the feed module and did exactly that.
  const payments = resolveFeatureSet('payments');
  const blocked = routeFiles(ROUTES_ROOT)
    .map(segmentsOf)
    .filter((segments) => disabledFeatureForRoute(segments, (feature) => payments[feature]))
    .map((segments) => segments.join('/'))
    .sort();
  expect(blocked).toMatchInlineSnapshot(`
    [
      "(ai-flow)/provider",
      "(ai-flow)/providers",
      "(drawer)/(tabs)/ai/index",
      "(mint-flow)/userMessages",
      "(profile-flow)/userMessages",
      "(profile-flow)/whitenoiseDM",
      "(profile-flow)/whitenoiseSetup",
      "(user-flow)/userMessages",
      "(user-flow)/whitenoiseDM",
      "(user-flow)/whitenoiseSetup",
      "userMessages",
    ]
  `);
});
