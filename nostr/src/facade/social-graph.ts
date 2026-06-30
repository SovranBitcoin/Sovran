import { z } from 'zod';
import type { NostrTier } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo } from '../map/feed';
import { NaggProfileInfoSchema } from '../schemas';
import { shouldReplace } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

// ---------------------------------------------------------------------------
// Social-graph surface — contacts / profiles / relay-lists
//
// "Fetch all my follows, with their profiles and my relay/mute lists, in one
// response." nagg owns the bulk seed with profiles bundled inline (Primal's
// contact_list extended_response). The relay floor reads the raw kind-3 / 10002
// / 10000 events. The anti-wipe invariant (reject an empty kind-3 over a
// non-empty stored one) is a WRITE/ingest concern owned by the local store, not
// this read; the read just surfaces the latest lists.
// ---------------------------------------------------------------------------

export type RelayListEntry = { url: string; read: boolean; write: boolean };

export type SocialGraph = {
  pubkey: string;
  follows: string[];
  profiles: Record<string, NaggProfileInfo>;
  relayList: RelayListEntry[];
  mutes: string[];
  /** `created_at` of the kind-3 the follows came from (0 if unknown). The app's
   *  last-writer-wins gate uses this so a facade seed and a relay delta cannot
   *  fight — the newer contact list always wins. */
  contactsUpdatedAt: number;
};

export type SocialGraphRequest = RequestControls & {
  pubkey: string;
  refresh?: boolean;
};

export type ResolvedSocialGraph = { tier: NostrTier } & SocialGraph;

export interface SocialGraphTier {
  readonly tier: NostrTier;
  getSocialGraph(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>>;
}

// nagg's bundled social-graph response (contact_list extended_response shape).
// Pins the contract PR-2 implements.
export const SocialGraphResponseSchema = z.object({
  pubkey: z.string(),
  follows: z.array(z.string()),
  profiles: z.record(z.string(), NaggProfileInfoSchema).optional(),
  relays: z
    .array(z.object({ url: z.string(), read: z.boolean().optional(), write: z.boolean().optional() }))
    .optional(),
  mutes: z.array(z.string()).optional(),
  /** `created_at` of the contact list nagg bundled this from (optional until the
   *  app-view surfaces it; treated as 0/unknown when absent). */
  contacts_updated_at: z.number().optional(),
});

export function socialGraphFromResponse(data: z.infer<typeof SocialGraphResponseSchema>): SocialGraph {
  return {
    pubkey: data.pubkey,
    follows: data.follows,
    profiles: data.profiles ?? {},
    relayList: (data.relays ?? []).map((r) => ({ url: r.url, read: r.read ?? true, write: r.write ?? true })),
    mutes: data.mutes ?? [],
    contactsUpdatedAt: data.contacts_updated_at ?? 0,
  };
}

// --- relay-floor parsing (latest kind-3 / 10002 / 10000) --------------------

const KIND_CONTACTS = 3;
const KIND_RELAY_LIST = 10_002;
const KIND_MUTE_LIST = 10_000;

/** Build a SocialGraph from the viewer's own replaceable list events. */
export function socialGraphFromEvents(pubkey: string, events: ReadonlyArray<NaggFeedEvent>): SocialGraph {
  const latest = latestByKind(events, [KIND_CONTACTS, KIND_RELAY_LIST, KIND_MUTE_LIST]);

  const contacts = latest.get(KIND_CONTACTS);
  const relays = latest.get(KIND_RELAY_LIST);
  const mutes = latest.get(KIND_MUTE_LIST);

  return {
    pubkey,
    follows: contacts ? pTagValues(contacts) : [],
    profiles: {}, // the floor fetches profiles separately (batched by the app)
    relayList: relays ? parseRelayList(relays) : [],
    mutes: mutes ? pTagValues(mutes) : [],
    contactsUpdatedAt: contacts?.created_at ?? 0,
  };
}

function latestByKind(
  events: ReadonlyArray<NaggFeedEvent>,
  kinds: number[],
): Map<number, NaggFeedEvent> {
  const wanted = new Set(kinds);
  const latest = new Map<number, NaggFeedEvent>();
  for (const event of events) {
    if (!wanted.has(event.kind)) continue;
    const current = latest.get(event.kind);
    if (shouldReplace(current ?? null, event)) latest.set(event.kind, event);
  }
  return latest;
}

function pTagValues(event: NaggFeedEvent): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'p' && typeof tag[1] === 'string') out.push(tag[1]);
  }
  return out;
}

function parseRelayList(event: NaggFeedEvent): RelayListEntry[] {
  const out: RelayListEntry[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue;
    const marker = tag[2];
    // NIP-65: no marker → read+write; 'read' / 'write' → one direction only.
    out.push({ url: tag[1], read: marker !== 'write', write: marker !== 'read' });
  }
  return out;
}
