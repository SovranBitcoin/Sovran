import { createNaggClient, NaggUnknownDataSchema, type NaggError } from '@sovranbitcoin/nagg-ts';
import { z } from 'zod';
import type { RequestControls } from './safeFetch';
import type { MintContactProfile, MintReviewRecommendation, MintReviewsSummary } from './types';

export interface NostrGraphqlMintEnrichmentConfig {
  endpoint: string;
  reviewLimit?: number;
  timeoutMs?: number;
}

export interface NostrGraphqlMintEnrichment {
  resolveMintContactProfile: (
    pubkey: string,
    mintUrl: string,
    controls?: RequestControls
  ) => Promise<MintContactProfile | undefined>;
  fetchMintReviews: (
    mintUrl: string,
    controls?: RequestControls
  ) => Promise<MintReviewsSummary | undefined>;
}

const ProfileMetadata = z
  .object({
    name: z.string().max(256).optional(),
    display_name: z.string().max(256).optional(),
    displayName: z.string().max(256).optional(),
    picture: z.string().max(2048).optional(),
    image: z.string().max(2048).optional(),
    banner: z.string().max(2048).optional(),
    about: z.string().max(4096).optional(),
    nip05: z.string().max(256).optional(),
    lud16: z.string().max(256).optional(),
    lud06: z.string().max(4096).optional(),
    website: z.string().max(2048).optional(),
  })
  .passthrough();

const GraphqlEvent = z
  .object({
    id: z.string().min(1),
    pubkey: z.string().min(1),
    kind: z.number().int(),
    createdAt: z.union([z.string(), z.number(), z.date()]),
    content: z.string(),
    tags: z.array(z.array(z.string())),
  })
  .passthrough();

const GraphqlEventWithPubkeyEvents = GraphqlEvent.extend({
  pubkeyEvents: z.array(GraphqlEvent).optional(),
});

const EventsConnection = z.object({
  nodes: z.array(GraphqlEventWithPubkeyEvents),
});

const ContactProfileData = z.object({
  events: EventsConnection,
});

const MintReviewsData = z.object({
  events: EventsConnection,
});

const CONTACT_PROFILE_QUERY = `
query ColadaMintContactProfile($pubkey: String!) {
  events(input: { pubkeys: [$pubkey], kinds: [0], limit: 1 }) {
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
    }
  }
}
`;

const MINT_REVIEWS_QUERY = `
query ColadaMintReviews($mintUrls: [String!]!, $limit: Int!) {
  events(input: {
    kinds: [38000],
    tags: [
      { key: "k", value: "38172" },
      { key: "u", values: $mintUrls }
    ],
    limit: $limit
  }) {
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
      pubkeyEvents(kinds: [0], limit: 1) {
        id
        pubkey
        kind
        createdAt
        content
        tags
      }
    }
  }
}
`;

export function createNostrGraphqlMintEnrichment(
  config: NostrGraphqlMintEnrichmentConfig
): NostrGraphqlMintEnrichment {
  const endpoint = config.endpoint.trim();
  const reviewLimit = Math.max(1, Math.min(config.reviewLimit ?? 100, 500));
  const client = createNaggClient({
    endpoint,
    defaultTimeoutMs: config.timeoutMs,
  });

  return {
    resolveMintContactProfile: async (pubkey, _mintUrl, controls = {}) => {
      const data = await postGraphql(client, CONTACT_PROFILE_QUERY, { pubkey }, ContactProfileData, {
        ...controls,
        timeoutMs: controls.timeoutMs ?? config.timeoutMs,
      });
      const event = data.events.nodes.find((node) => node.kind === 0 && node.pubkey === pubkey);
      const profile = event ? parseProfileEvent(event.content) : null;
      if (!profile) return undefined;
      return {
        pubkey,
        ...profileFields(profile),
      };
    },

    fetchMintReviews: async (mintUrl, controls = {}) => {
      const mintUrls = mintURLCandidates(mintUrl);
      const data = await postGraphql(
        client,
        MINT_REVIEWS_QUERY,
        { mintUrls, limit: reviewLimit },
        MintReviewsData,
        {
          ...controls,
          timeoutMs: controls.timeoutMs ?? config.timeoutMs,
        }
      );
      const recommendations = data.events.nodes
        .filter((event) => event.kind === 38000 && isReviewForMint(event, mintUrls))
        .map(reviewFromEvent)
        .filter((review): review is MintReviewRecommendation => review !== null)
        .sort((a, b) => b.created_at - a.created_at);

      const score =
        recommendations.length > 0
          ? recommendations.reduce((sum, review) => sum + review.score, 0) / recommendations.length
          : null;
      const lastUpdated =
        recommendations.length > 0
          ? Math.max(...recommendations.map((review) => review.created_at))
          : null;

      return {
        mintUrl,
        score,
        recommendations,
        lastUpdated,
        fromCache: true,
      };
    },
  };
}

async function postGraphql<T extends z.ZodType>(
  client: ReturnType<typeof createNaggClient>,
  query: string,
  variables: Record<string, unknown>,
  dataSchema: T,
  controls: RequestControls
): Promise<z.infer<T>> {
  const result = await client.query({
    query,
    variables,
    dataSchema: NaggUnknownDataSchema,
    signal: controls.signal,
    timeoutMs: controls.timeoutMs,
  });
  if (result.isErr()) {
    throw errorFromNaggError(result.error);
  }
  const parsed = dataSchema.safeParse(result.value);
  if (!parsed.success) {
    throw new Error('GraphQL response did not match the expected shape');
  }
  return parsed.data;
}

function errorFromNaggError(error: NaggError): Error {
  const out = new Error(error.message);
  out.name =
    error.type === 'network' && /abort|timed out|timeout/i.test(error.message)
      ? 'AbortError'
      : 'NaggGraphqlError';
  return out;
}

function parseProfileEvent(content: string):
  | {
      name?: string;
      displayName?: string;
      picture?: string;
      image?: string;
    }
  | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = ProfileMetadata.safeParse(raw);
  if (!parsed.success) return null;
  return {
    name: parsed.data.name,
    displayName: parsed.data.display_name ?? parsed.data.displayName,
    picture: parsed.data.picture,
    image: parsed.data.image,
  };
}

function reviewFromEvent(event: z.infer<typeof GraphqlEventWithPubkeyEvents>) {
  const parsed = parseMintReviewContent(event.content);
  if (!parsed) return null;
  const profileEvent = event.pubkeyEvents?.find((profile) => profile.kind === 0);
  const profile = profileEvent ? parseProfileEvent(profileEvent.content) : null;
  return {
    score: parsed.score,
    comment: parsed.comment,
    pubkey: event.pubkey,
    eventId: event.id,
    created_at: eventCreatedAtSeconds(event.createdAt),
    ...(profile ? profileFields(profile) : {}),
  };
}

function profileFields(profile: {
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
}) {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

function parseMintReviewContent(raw: string): { score: number; comment: string } | null {
  const match = raw.match(/^\s*\[(\d+)\/(\d+)\]\s*(.*)$/);
  if (!match) return null;
  const score = Number.parseInt(match[1] ?? '', 10);
  const outOf = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(score) || score < 0 || score > 5 || outOf !== 5) return null;
  return { score, comment: match[3]?.trim() ?? '' };
}

function isReviewForMint(event: z.infer<typeof GraphqlEventWithPubkeyEvents>, mintUrls: string[]) {
  const reviewedURLs = tagValues(event.tags, 'u');
  return (
    tagValues(event.tags, 'k').includes('38172') &&
    mintUrls.some((url) => reviewedURLs.includes(url))
  );
}

function tagValues(tags: string[][], key: string): string[] {
  return tags.flatMap((tag) => (tag[0] === key && tag[1] ? [tag[1]] : []));
}

function mintURLCandidates(value: string): string[] {
  const trimmed = value.trim();
  const withoutSlash = trimmed.replace(/\/+$/, '');
  const withSlash = withoutSlash ? `${withoutSlash}/` : '';
  return Array.from(new Set([trimmed, withoutSlash, withSlash].filter(Boolean)));
}

function eventCreatedAtSeconds(value: string | number | Date): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number') return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}
