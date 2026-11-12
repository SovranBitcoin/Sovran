/** @jest-environment node */
import { fixturesRequiringFreeze } from '../scripts/persistence/freeze';
it('requires freezing the newest fixture once its version is observed as installable', () => {
  const fixtures = [
    { epoch: 'E19', versions: ['0.1.3'], commit: '1234567' },
    { epoch: 'E20', versions: ['0.1.4'], commit: '7654321' },
  ];
  expect(fixturesRequiringFreeze(fixtures, []).map((fixture) => fixture.epoch)).toEqual(['E19']);
  expect(
    fixturesRequiringFreeze(fixtures, [
      {
        id: 'ios:0.1.4',
        platform: 'ios',
        channel: 'app-store',
        version: '0.1.4',
        evidence: 'published',
        source: 'https://apps.apple.com/app/id6499554529',
      },
    ]).map((fixture) => fixture.epoch)
  ).toEqual(['E19', 'E20']);
});
