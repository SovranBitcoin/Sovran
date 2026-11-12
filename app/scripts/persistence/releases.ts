import { z } from 'zod';

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const observationSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(['ios', 'android', 'github']),
  channel: z.enum(['app-store', 'google-play', 'github-apk', 'github-release', 'eas']),
  version,
  build: z.string().optional(),
  sourceSha: z
    .string()
    .regex(/^[a-f0-9]{7,40}$/)
    .optional(),
  sourceKnown: z.boolean().optional(),
  evidence: z.enum(['published', 'installable-build', 'release-only']),
  releasedAt: z.string().optional(),
  source: z.string().min(1),
});
export type ReleaseObservation = z.infer<typeof observationSchema>;
export const catalogSchema = z.object({
  schema: z.literal(1),
  observedAt: z.string(),
  sources: z.array(z.object({ source: z.string(), scope: z.string(), limitation: z.string() })),
  observations: z.array(observationSchema),
});
export type ReleaseCatalog = z.infer<typeof catalogSchema>;

const appleEnvelope = z.object({
  data: z.array(
    z.object({
      intent: z.object({ id: z.string() }),
      data: z.unknown(),
    })
  ),
});
const appleShelf = z.object({
  shelfMapping: z.object({
    mostRecentVersion: z.object({
      seeAllAction: z.object({
        pageData: z.object({
          shelves: z.array(
            z.object({
              items: z.array(z.object({ primarySubtitle: version, secondarySubtitle: z.string() })),
            })
          ),
        }),
      }),
    }),
  }),
});
export function appleHistory(html: string): ReleaseObservation[] {
  const script = html.match(
    /<script\b[^>]*\bid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i
  )?.[1];
  if (!script) throw new Error('Apple structured version history is missing');
  const envelope = appleEnvelope.parse(JSON.parse(script));
  const app = envelope.data.find((entry) => entry.intent.id === '6499554529');
  if (!app) throw new Error('Apple page does not identify app 6499554529');
  const history = appleShelf.parse(app.data).shelfMapping.mostRecentVersion.seeAllAction.pageData;
  const source = 'https://apps.apple.com/gb/app/sovran/id6499554529';
  const records = history.shelves
    .flatMap((shelf) => shelf.items)
    .map((item) => {
      const date = new Date(item.secondarySubtitle);
      if (!Number.isFinite(date.getTime()))
        throw new Error(`Invalid Apple release date: ${item.primarySubtitle}`);
      return observationSchema.parse({
        id: `apple:gb:${item.primarySubtitle}`,
        platform: 'ios',
        channel: 'app-store',
        version: item.primarySubtitle,
        evidence: 'published',
        releasedAt: date.toISOString(),
        source,
      });
    });
  if (!records.length) throw new Error('Apple structured version history is empty');
  return records;
}

const channelSchema = z.object({
  version,
  build: z.string(),
  sourceSha: z.string(),
  confirmedAt: z.string(),
  url: z.string().url(),
});
const stateSchema = z.object({
  channels: z.object({
    appStore: channelSchema.optional(),
    googlePlay: channelSchema.optional(),
    githubApk: channelSchema.optional(),
  }),
});
export function pipelineReleases(input: unknown, revision: string): ReleaseObservation[] {
  const state = stateSchema.parse(input);
  const channels = [
    { key: 'appStore', platform: 'ios', channel: 'app-store' },
    { key: 'googlePlay', platform: 'android', channel: 'google-play' },
    { key: 'githubApk', platform: 'android', channel: 'github-apk' },
  ] as const;
  return channels.flatMap(({ key, platform, channel }) => {
    const found = state.channels[key];
    return found
      ? [
          observationSchema.parse({
            id: `pipeline:${revision}:${channel}:${found.version}:${found.build}`,
            platform,
            channel,
            version: found.version,
            build: found.build,
            sourceSha: found.sourceSha,
            evidence: 'published',
            releasedAt: found.confirmedAt,
            source: `https://github.com/SovranBitcoin/Sovran/tree/${revision}`,
          }),
        ]
      : [];
  });
}

const githubSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullable(),
    html_url: z.string().url(),
    assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url() })),
  })
);
export function githubReleases(input: unknown): ReleaseObservation[] {
  return githubSchema
    .parse(input)
    .filter((entry) => !entry.draft && !entry.prerelease && entry.published_at)
    .flatMap((entry) => {
      const releaseVersion = version.parse(entry.tag_name.replace(/^v/, ''));
      const apks = entry.assets.filter((asset) => asset.name.endsWith('.apk'));
      return [
        observationSchema.parse({
          id: `github:${entry.tag_name}`,
          platform: 'github',
          channel: 'github-release',
          version: releaseVersion,
          evidence: 'release-only',
          releasedAt: entry.published_at,
          source: entry.html_url,
        }),
        ...apks.map((asset) =>
          observationSchema.parse({
            id: `github:${entry.tag_name}:${asset.name}`,
            platform: 'android',
            channel: 'github-apk',
            version: releaseVersion,
            evidence: 'published',
            releasedAt: entry.published_at,
            source: asset.browser_download_url,
          })
        ),
      ];
    });
}

export function easBuilds(tsv: string): ReleaseObservation[] {
  const [header, ...lines] = tsv
    .trim()
    .split('\n')
    .map((line) => line.split('\t'));
  const columns = [
    'date',
    'platform',
    'profile',
    'version',
    'build',
    'commit',
    'in_repo',
    'on_main',
  ];
  if (JSON.stringify(header) !== JSON.stringify(columns))
    throw new Error('Unexpected EAS build inventory columns');
  return lines.map((cells, index) => {
    if (cells.length !== columns.length) throw new Error(`Invalid EAS inventory row ${index + 2}`);
    const [date, platform, , releaseVersion, build, commit, inRepo] = cells;
    return observationSchema.parse({
      id: `eas:${platform}:${releaseVersion}:${build}:${commit}:${date}`,
      platform,
      channel: 'eas',
      version: releaseVersion,
      build,
      ...(commit !== '-' ? { sourceSha: commit } : {}),
      sourceKnown: inRepo === 'yes',
      evidence: 'installable-build',
      releasedAt: date,
      source: 'docs/architecture/persistence/store-builds.tsv',
    });
  });
}

type FixtureVersion = { epoch: string; versions: readonly string[]; commit: string };
export function mapRelease(release: ReleaseObservation, fixtures: readonly FixtureVersion[]) {
  const candidates = fixtures.filter((fixture) => fixture.versions.includes(release.version));
  const exact =
    release.sourceSha && release.sourceKnown !== false
      ? candidates.filter(
          (fixture) =>
            /^[a-f0-9]{7,40}$/.test(fixture.commit) &&
            (release.sourceSha?.startsWith(fixture.commit) ||
              fixture.commit.startsWith(release.sourceSha ?? ''))
        )
      : [];
  return {
    kind: exact.length ? 'source' : candidates.length ? 'version-candidates' : 'unmapped',
    epochs: (exact.length ? exact : candidates).map((fixture) => fixture.epoch),
  };
}

/** A shorter upstream history can never erase retained historical evidence. */
export function retainHistory(
  previous: readonly ReleaseObservation[],
  observed: readonly ReleaseObservation[]
) {
  const records = new Map(previous.map((record) => [record.id, record]));
  for (const record of observed) {
    const before = records.get(record.id);
    if (before && JSON.stringify(before) !== JSON.stringify(record))
      throw new Error(`Contradictory release evidence: ${record.id}`);
    records.set(record.id, record);
  }
  const confirmations = new Map<string, string>();
  for (const record of records.values()) {
    if (record.evidence !== 'published' || !record.build || !record.sourceSha) continue;
    const identity = `${record.platform}/${record.channel}/${record.version}/${record.build}`;
    const before = confirmations.get(identity);
    if (before && before !== record.sourceSha)
      throw new Error(`Conflicting published source: ${identity}`);
    confirmations.set(identity, record.sourceSha);
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}
