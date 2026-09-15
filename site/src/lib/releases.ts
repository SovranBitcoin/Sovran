// Ported from sovran.money/src/releaseAvailability.ts, without React or its snapshot.
export const channels = ['appStore', 'freedomStore', 'googlePlay', 'githubApk', 'zapstore'] as const;
export type ReleaseChannel = (typeof channels)[number];
export type AvailableRelease = { version: string; build: string; url: string; sha256?: string; certificateSha256?: string; size?: number };
export type ReleaseAvailability = Record<ReleaseChannel, AvailableRelease | null>;
export const channelLabels: Record<ReleaseChannel, string> = {
  appStore: 'App Store', freedomStore: 'Freedom Store', googlePlay: 'Google Play', githubApk: 'Android APK', zapstore: 'Zapstore',
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAvailability(input: unknown): ReleaseAvailability {
  if (!record(input) || input.schemaVersion !== 1 || !record(input.channels)) throw new Error('Invalid release availability');
  const result = {} as ReleaseAvailability;
  for (const channel of channels) {
    if (!Object.hasOwn(input.channels, channel)) throw new Error('Missing release channel');
    const value = input.channels[channel];
    if (value === null) { result[channel] = null; continue; }
    if (!record(value) || typeof value.url !== 'string' || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version) || typeof value.build !== 'string' || !/^\d+$/.test(value.build)) throw new Error('Unconfirmed release');
    const url = new URL(value.url);
    // Reject URL normalization tricks as well as unexpected destinations.
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || (url.href !== value.url && !(channel === 'freedomStore' && value.url === 'https://freedomstore.io'))) throw new Error('Invalid release destination');
    const validDestination = {
      appStore: url.hostname === 'apps.apple.com' && url.pathname === '/app/id6499554529' && !url.search,
      freedomStore: url.hostname === 'freedomstore.io' && url.pathname === '/' && !url.search,
      googlePlay: url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && url.search === '?id=com.sovranbitcoin',
      githubApk: url.hostname === 'github.com' && url.pathname === `/SovranBitcoin/Sovran/releases/download/v${value.version}/sovran-${value.version}.apk` && !url.search,
      zapstore: url.hostname === 'zapstore.dev' && url.pathname === '/apps/com.sovranbitcoin' && !url.search,
    }[channel];
    if (!validDestination) throw new Error('Unexpected release destination');
    for (const field of ['sha256', 'certificateSha256'] as const) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || !/^[a-f0-9]{64}$/.test(value[field]))) throw new Error('Invalid artifact fingerprint');
    }
    if (value.sourceSha !== undefined && (typeof value.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceSha))) throw new Error('Invalid source revision');
    if (value.confirmedAt !== undefined && (typeof value.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.confirmedAt) || !Number.isFinite(Date.parse(value.confirmedAt)) || new Date(value.confirmedAt).toISOString() !== value.confirmedAt)) throw new Error('Invalid confirmation time');
    if (value.size !== undefined && (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0)) throw new Error('Invalid artifact size');
    result[channel] = { version: value.version, build: value.build, url: value.url };
    if (typeof value.sha256 === 'string') result[channel].sha256 = value.sha256;
    if (typeof value.certificateSha256 === 'string') result[channel].certificateSha256 = value.certificateSha256;
    if (typeof value.size === 'number') result[channel].size = value.size;
  }
  return result;
}

export async function fetchAvailability(fetcher: typeof fetch = fetch): Promise<ReleaseAvailability> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher('/releases/channels.json', { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) throw new Error('Release metadata unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 100_000) { await reader.cancel(); throw new Error('Release metadata too large'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseAvailability(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timeout); controller.abort(); }
}
