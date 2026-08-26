import { parseWith } from '@sovranbitcoin/schemas';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { backendConfig } from '@/shared/config/backend';
import { fetchJson } from '@/shared/lib/apiClient';
import type { NostrPubkeyHex } from '@/shared/lib/protocolIds';
import {
  Kind0MetadataSchema,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';

type RecentPeopleProfileMetadata = Partial<Omit<NostrProfileMetadata, 'fetchedAt'>>;

const BASE_EVENT_SELECTION = `
  id
  pubkey
  kind
  createdAt
  content
  tags
`;

const RECENT_PEOPLE_PROFILES_QUERY = `
query NaggRecentPeopleProfiles($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
    }
  }
}
`;

const PROFILE_EVENT_LIMIT_MULTIPLIER = 4;
const PROFILE_EVENT_LIMIT_MAX = 100;

const GraphqlProfileEventSchema = z.looseObject({
  id: z.string(),
  pubkey: z.string(),
  kind: z.number().int(),
  createdAt: z.union([z.string(), z.number()]).optional(),
  content: z.string(),
  tags: z.array(z.array(z.string())).default([]),
});

const RecentPeopleProfilesEnvelopeSchema = z.looseObject({
  data: z
    .looseObject({
      events: z
        .looseObject({
          nodes: z.array(GraphqlProfileEventSchema).default([]),
        })
        .optional(),
    })
    .optional(),
  errors: z
    .array(
      z.looseObject({
        message: z.string().optional(),
      })
    )
    .optional(),
});

const parseRecentPeopleProfilesEnvelope = parseWith(
  RecentPeopleProfilesEnvelopeSchema,
  'nagg/recent-people-profiles'
);

type GraphqlProfileEvent = z.infer<typeof GraphqlProfileEventSchema>;

export function buildRecentPeopleProfilesGraphqlBody(pubkeys: readonly string[]): {
  query: string;
  variables: { input: { kinds: number[]; pubkeys: string[]; limit: number } };
} {
  const normalizedPubkeys = uniquePubkeys(pubkeys);
  return {
    query: RECENT_PEOPLE_PROFILES_QUERY,
    variables: {
      input: {
        kinds: [0],
        pubkeys: normalizedPubkeys,
        limit: Math.min(
          PROFILE_EVENT_LIMIT_MAX,
          Math.max(
            normalizedPubkeys.length,
            normalizedPubkeys.length * PROFILE_EVENT_LIMIT_MULTIPLIER
          )
        ),
      },
    },
  };
}

export function mapRecentPeopleProfileEvents(
  nodes: readonly GraphqlProfileEvent[]
): Record<string, RecentPeopleProfileMetadata> {
  const newestByPubkey = new Map<
    string,
    { createdAt: number; metadata: RecentPeopleProfileMetadata }
  >();

  for (const node of nodes) {
    if (node.kind !== 0) continue;
    const pubkey = normalizeRecentPersonPubkey(node.pubkey);
    if (!pubkey) continue;
    const metadata = parseProfileMetadata(node.content);
    if (!metadata) continue;
    const createdAt = createdAtSeconds(node.createdAt);
    const existing = newestByPubkey.get(pubkey);
    if (!existing || createdAt >= existing.createdAt) {
      newestByPubkey.set(pubkey, { createdAt, metadata });
    }
  }

  return Object.fromEntries(
    Array.from(newestByPubkey.entries()).map(([pubkey, entry]) => [pubkey, entry.metadata])
  );
}

export async function fetchRecentPeopleProfiles(
  pubkeys: readonly string[],
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Result<Record<string, RecentPeopleProfileMetadata>, Error>> {
  const normalizedPubkeys = uniquePubkeys(pubkeys);
  if (normalizedPubkeys.length === 0) return ok({});

  const body = buildRecentPeopleProfilesGraphqlBody(normalizedPubkeys);
  const result = await fetchJson(
    backendConfig.nostrGraphqlEndpoint,
    parseRecentPeopleProfilesEnvelope,
    'nagg/recent-people-profiles',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    controls
  );
  if (result.isErr()) return err(result.error);

  const firstError = result.value.errors?.[0]?.message;
  if (firstError) return err(new Error(firstError));

  return ok(mapRecentPeopleProfileEvents(result.value.data?.events?.nodes ?? []));
}

function uniquePubkeys(pubkeys: readonly string[]): NostrPubkeyHex[] {
  return Array.from(
    new Set(
      pubkeys
        .map((pubkey) => normalizeRecentPersonPubkey(pubkey))
        .filter((pubkey): pubkey is NostrPubkeyHex => !!pubkey)
    )
  );
}

function parseProfileMetadata(content: string): RecentPeopleProfileMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const result = Kind0MetadataSchema.safeParse(parsed);
  if (!result.success) return null;
  const raw = result.data;
  const metadata: RecentPeopleProfileMetadata = {
    displayName: raw.display_name ?? raw.displayName,
    name: raw.name,
    picture: raw.picture,
    banner: raw.banner,
    nip05: raw.nip05,
    lud16: raw.lud16,
    website: raw.website,
    about: raw.about,
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === 'string' && value.length > 0)
  );
}

function createdAtSeconds(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}
