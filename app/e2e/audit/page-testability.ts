/** Source coverage inventory. Native execution evidence remains in run manifests. */
import { join } from 'node:path';
import { loadE2E } from '../core/loader';
import { effectiveRequirements } from '../core/plan';
import { CANONICAL_PAGES } from '../schema/pages';
import { PAGE_ROUTES } from '../schema/page-routes';
import { scenarioPlatforms } from '../schema/capabilities';
const loaded = loadE2E(join(import.meta.dir, '..'));
if (loaded.issues.length)
  throw new Error('Validate the e2e definitions before generating page coverage');
const rows = CANONICAL_PAGES.map((page) => {
  const scenarios = [...loaded.scenarios.values()].filter((scenario) =>
    [...scenario.steps, ...scenario.verify].some(
      (step) => 'action' in step && step.action === 'screenshot' && step.name === page
    )
  );
  const forPlatform = (platform: 'ios' | 'android') =>
    scenarios
      .filter((scenario) =>
        scenarioPlatforms(effectiveRequirements(scenario, loaded.fixtures)).includes(platform)
      )
      .map((scenario) => scenario.id);
  return {
    page,
    routes: PAGE_ROUTES[page] ?? [],
    ios: forPlatform('ios'),
    android: forPlatform('android'),
  };
});
process.stdout.write(
  [
    '# Native page testability inventory',
    '',
    'Generated from the route catalog and authored screenshot scenarios. These are candidate journeys, **not native pass evidence**, gesture coverage, or proof that each route alias was exercised. Blank cells identify authoring gaps. Run manifests establish platform execution; review each changed interaction under SYSTEM.md decision 26.',
    '',
    '| Page | Route aliases | iPhone scenarios | Android scenarios |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.page} | ${row.routes.map((route) => '`' + route + '`').join('<br>') || 'Non-route surface'} | ${row.ios.join(', ') || '**Gap**'} | ${row.android.join(', ') || '**Gap**'} |`
    ),
    '',
  ].join('\n')
);
