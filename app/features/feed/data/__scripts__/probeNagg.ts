import { parseResponse, prettify, type FetchParseError } from '@sovranbitcoin/schemas';
import { z, type ZodType } from 'zod';
import { NaggEnrichmentResponse, NaggFeedResponse, NaggThreadResponse } from '../naggSchemas';

type Probe = {
  name: string;
  path: string;
  init?: RequestInit;
  schema?: ZodType;
  optional?: boolean;
};

const UnknownResponse = z.unknown();

const DEFAULT_NAGG_BASE_URL = 'https://nagg.up.railway.app';

const baseUrl = stripTrailingSlash(
  process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL ||
    process.env.EXPO_PUBLIC_NAGG_BASE_URL ||
    process.env.NAGG_BASE_URL ||
    DEFAULT_NAGG_BASE_URL
);
const pubkey = process.env.NAGG_PROBE_PUBKEY;
const eventId = process.env.NAGG_PROBE_EVENT_ID;

const probes: Probe[] = [
  { name: 'healthz', path: '/healthz' },
  {
    name: 'follows feed',
    path: pubkey ? `/nostr/feed?kind=follows&pubkeys=${encodeURIComponent(pubkey)}&limit=5` : '',
    schema: NaggFeedResponse,
    optional: !pubkey,
  },
  {
    name: 'user feed',
    path: pubkey ? `/nostr/feed/user?pubkey=${encodeURIComponent(pubkey)}&limit=5` : '',
    schema: NaggFeedResponse,
    optional: !pubkey,
  },
  {
    name: 'follows',
    path: pubkey ? `/nostr/follows?pubkey=${encodeURIComponent(pubkey)}` : '',
    optional: !pubkey,
  },
  {
    name: 'thread',
    path: eventId ? `/nostr/thread?id=${encodeURIComponent(eventId)}&limit=100` : '',
    schema: NaggThreadResponse,
    optional: !eventId,
  },
  {
    name: 'events enrichment',
    path: eventId ? `/nostr/events?ids=${encodeURIComponent(eventId)}` : '',
    schema: NaggEnrichmentResponse,
    optional: !eventId,
  },
  {
    name: 'notes stats',
    path: '/nostr/notes/stats',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: eventId ? [eventId] : [] }),
    },
  },
  {
    name: 'profile',
    path: pubkey ? `/nostr/profile?pubkey=${encodeURIComponent(pubkey)}` : '',
    optional: !pubkey,
  },
  {
    name: 'search',
    path: '/nostr/search?query=jack&limit=5',
    optional: !process.env.NAGG_VERTEX_PRIVATE_KEY,
  },
];

let failed = false;

for (const probe of probes) {
  if (probe.optional) {
    writeLine(`skip ${probe.name}`);
    continue;
  }
  try {
    await fetchJSON(`${baseUrl}${probe.path}`, probe.init, probe.schema ?? UnknownResponse);
    writeLine(`ok ${probe.name}`);
  } catch (error) {
    failed = true;
    writeLine(
      `fail ${probe.name}: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

if (failed) process.exit(1);

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function fetchJSON<T>(
  url: string,
  init: RequestInit | undefined,
  schema: ZodType<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await parseResponse(schema, 'nagg/probe', url, {
      ...init,
      signal: controller.signal,
    });
    if (result.isOk()) return result.value;
    throw new Error(formatProbeError(result.error));
  } finally {
    clearTimeout(timeout);
  }
}

function formatProbeError(error: FetchParseError): string {
  if (error.type === 'schema/zod') return prettify(error);
  return error.message;
}

function writeLine(message: string, stderr = false): void {
  const stream = stderr ? process.stderr : process.stdout;
  stream.write(`${message}\n`);
}
