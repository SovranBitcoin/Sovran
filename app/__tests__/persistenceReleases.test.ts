/** @jest-environment node */
import {
  appleHistory,
  githubReleases,
  pipelineReleases,
  mapRelease,
  retainHistory,
} from '../scripts/persistence/releases';

const page = (id = '6499554529') =>
  `<script id="serialized-server-data">${JSON.stringify({
    data: [
      {
        intent: { id },
        data: {
          shelfMapping: {
            mostRecentVersion: {
              seeAllAction: {
                pageData: {
                  shelves: [
                    {
                      items: [
                        {
                          primarySubtitle: '0.1.2',
                          secondarySubtitle: 'Sat Sep 12 2026 13:45:20 GMT+0000',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  })}</script><p>Recommendation for another app: 9.9.9</p>`;

it('reads only this app’s structured published history, retaining the retired 0.1.2 publication', () => {
  expect(appleHistory(page())).toEqual([
    expect.objectContaining({
      platform: 'ios',
      channel: 'app-store',
      version: '0.1.2',
      evidence: 'published',
      releasedAt: '2026-09-12T13:45:20.000Z',
    }),
  ]);
  expect(() => appleHistory(page('another-app'))).toThrow('6499554529');
  expect(() => appleHistory('<p>0.1.3</p>')).toThrow('structured');
});

it('does not turn a retired pipeline attempt or an empty channel list into publication', () => {
  expect(
    pipelineReleases({ version: '0.1.2', complete: true, retired: true, channels: {} }, 'abc')
  ).toEqual([]);
  expect(
    pipelineReleases(
      {
        channels: {
          googlePlay: {
            version: '0.1.3',
            build: '24',
            sourceSha: 'd9ad12c4bde03b609cd90a4487c466b88007a4cb',
            confirmedAt: '2026-09-12T17:00:00Z',
            url: 'https://play.google.com/store/apps/details?id=com.sovranbitcoin',
          },
        },
      },
      'abc'
    )
  ).toEqual([expect.objectContaining({ platform: 'android', build: '24', evidence: 'published' })]);
});

it('keeps every candidate epoch for an ambiguous public version and names an unknown version', () => {
  const release = appleHistory(page())[0];
  const fixtures = [
    { epoch: 'E18', versions: ['0.1.2'], commit: '1234567' },
    { epoch: 'E19', versions: ['0.1.2'], commit: '7654321' },
  ];
  expect(mapRelease(release, fixtures)).toEqual({
    kind: 'version-candidates',
    epochs: ['E18', 'E19'],
  });
  expect(mapRelease({ ...release, version: '9.9.9' }, fixtures)).toEqual({
    kind: 'unmapped',
    epochs: [],
  });
});

it('retains historical publications when an upstream page drops them and rejects contradictory evidence', () => {
  const records = appleHistory(page());
  expect(retainHistory(records, [])).toEqual(records);
  expect(() => retainHistory(records, [{ ...records[0], version: '9.9.9' }])).toThrow(
    'Contradictory'
  );
});

it('refuses two confirmed source commits for the same published channel version and build', () => {
  const old = pipelineReleases(
    {
      channels: {
        googlePlay: {
          version: '0.1.3',
          build: '24',
          sourceSha: 'a'.repeat(40),
          confirmedAt: '2026-09-12T17:00:00Z',
          url: 'https://play.google.com/store/apps/details?id=com.sovranbitcoin',
        },
      },
    },
    'old'
  );
  const changed = pipelineReleases(
    {
      channels: {
        googlePlay: {
          version: '0.1.3',
          build: '24',
          sourceSha: 'b'.repeat(40),
          confirmedAt: '2026-09-13T17:00:00Z',
          url: 'https://play.google.com/store/apps/details?id=com.sovranbitcoin',
        },
      },
    },
    'new'
  );
  expect(() => retainHistory(old, changed)).toThrow('Conflicting published source');
});

it('maps every retained observation and every current build inventory entry to an explicit candidate set', () => {
  const { RELEASE_FIXTURES } =
    jest.requireActual<typeof import('./releaseFixtures')>('./releaseFixtures');
  const catalog: unknown = jest.requireActual('./releaseFixtures/published.json');
  const { catalogSchema, easBuilds } = jest.requireActual<
    typeof import('../scripts/persistence/releases')
  >('../scripts/persistence/releases');
  const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
  const { join } = jest.requireActual<typeof import('node:path')>('node:path');
  const held = catalogSchema.parse(catalog);
  expect(held.sources.map((source) => source.source)).toContain(
    'https://apps.apple.com/gb/app/sovran/id6499554529'
  );
  const incoming = easBuilds(
    readFileSync(join(__dirname, '../../docs/architecture/persistence/store-builds.tsv'), 'utf8')
  );
  expect(incoming.length).toBeGreaterThan(0);
  const missing = [...held.observations, ...incoming].filter(
    (record) => mapRelease(record, RELEASE_FIXTURES).epochs.length === 0
  );
  expect(
    missing.map(
      (record) =>
        `${record.platform} ${record.version} build ${record.build ?? 'unknown'}: ${record.id}`
    )
  ).toEqual([]);
});

it('does not call an empty unfinished GitHub upload a published Android APK', () => {
  const entry = {
    tag_name: 'v0.1.3',
    draft: false,
    prerelease: false,
    published_at: '2026-09-12T18:44:28Z',
    html_url: 'https://github.com/SovranBitcoin/Sovran/releases/tag/v0.1.3',
    assets: [
      {
        name: 'wallet.apk',
        state: 'starter',
        size: 0,
        browser_download_url:
          'https://github.com/SovranBitcoin/Sovran/releases/download/v0.1.3/wallet.apk',
      },
    ],
  };
  expect(githubReleases([entry]).map((record) => record.evidence)).toEqual(['release-only']);
  expect(
    githubReleases([
      { ...entry, assets: [{ ...entry.assets[0], state: 'uploaded', size: 123 }] },
    ]).map((record) => record.evidence)
  ).toEqual(['release-only', 'published']);
});

it('can enrich an observation with an actual resolved tag commit without inventing a source from a branch name', () => {
  const entry = {
    tag_name: 'v0.1.3',
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    published_at: '2026-09-12T18:44:28Z',
    html_url: 'https://github.com/SovranBitcoin/Sovran/releases/tag/v0.1.3',
    assets: [],
  };
  const previous = githubReleases([entry]);
  expect(previous[0].sourceSha).toBeUndefined();
  const enriched = githubReleases([entry], new Map([['v0.1.3', 'a'.repeat(40)]]));
  expect(retainHistory(previous, enriched)[0].sourceSha).toBe('a'.repeat(40));
});
