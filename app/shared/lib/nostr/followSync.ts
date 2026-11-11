/**
 * Publishes the person's follow and unfollow taps, one follow list (kind 3)
 * at a time per account.
 *
 * A tap only records the intent (`setFollowIntent`), so the button answers at
 * once. This worker turns every outstanding intent into one list: it reads the
 * newest signed list from every write relay, applies only the intents to that
 * list's tags and content exactly as they are, publishes, and records the
 * result. A follow list replaces the whole previous one on relays, so it only
 * ever builds on the list a complete read just returned (`planFollowPublish`):
 * anything less and the intents wait, to be tried again after hydration, when
 * a list arrives, on returning to the foreground and on the next tap.
 *
 * Two devices publishing at the same moment can still overwrite each other;
 * that is how the list works on Nostr.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import { Contacts } from 'nostr-tools/kinds';
import { supersedes, tiers, type facade } from 'nostr';
import { z } from 'zod';

import { nostrLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { getKnownOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import {
  selectContactList,
  selectFollowIntents,
  useNostrSocialStore,
  type ContactList,
} from '@/shared/stores/profile/nostrSocialStore';
import { captureActiveProfile } from '@/shared/stores/global/profileStore';
import {
  matchingSigner,
  readNewestOwnEvent,
  type OwnEventReadOutcome,
} from './ownReplaceableEvent';
import { publishEvent } from './publish';

type FollowIntents = ReturnType<typeof selectFollowIntents>;

/** What the indexers (nagg, Primal, relay tier) say about the account's list. */
type IndexedList = 'none' | 'exists' | 'unanswered';

/** A follow list as signed: the base a publish builds on. */
type ReadList = { tags: string[][]; content: string; createdAt: number; id: string };

/**
 * How this run's read of the write relays ended. Only a complete read says
 * what the relays hold; a partial one may have missed the newest list.
 */
type ListRead =
  | { status: 'incomplete' }
  | { status: 'unusable' }
  | { status: 'empty' }
  | { status: 'found'; list: ReadList };

type FollowPlan =
  | { step: 'idle' }
  | {
      step: 'wait';
      reason:
        | 'read-incomplete'
        | 'unusable-list'
        | 'newer-known'
        | 'same-second-unknown'
        | 'list-elsewhere'
        | 'no-list';
    }
  | { step: 'ask-indexers' }
  | { step: 'already-applied' }
  | { step: 'publish'; base: ReadList; tags: string[][] };

const EMPTY_LIST: ReadList = { tags: [], content: '', createdAt: 0, id: '' };

/** The list's tags with only the intents applied; every other entry stays as read. */
export function applyFollowIntents(tags: string[][], intents: FollowIntents): string[][] {
  const listed = (pubkey: string) => tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey);
  const next = tags.filter((tag) => !(tag[0] === 'p' && intents[tag[1]]?.value === false));
  for (const [pubkey, intent] of Object.entries(intents))
    if (intent.value && !listed(pubkey)) next.push(['p', pubkey]);
  return next;
}

/**
 * Pure: what to do with the outstanding intents, given this run's read and
 * the list the store knew before it. Both a publish and settling a tap the
 * list already holds stand only on the list a complete read returned, and
 * only when the store knows no list that relays keep over it: a newer one, or
 * one from the same second with a lower id (or whose id it does not know). Known-empty needs every write relay to have
 * answered with no list, no list or seed ever loaded for the account, and
 * every enabled indexer settled without a list and without failing
 * (`askIndexers`).
 */
export function planFollowPublish(input: {
  intents: FollowIntents;
  read: ListRead;
  known: ContactList;
  indexed?: IndexedList;
}): FollowPlan {
  const { intents, read, known } = input;
  if (Object.keys(intents).length === 0) return { step: 'idle' };
  let base: ReadList;
  switch (read.status) {
    case 'incomplete':
      return { step: 'wait', reason: 'read-incomplete' };
    case 'unusable':
      return { step: 'wait', reason: 'unusable-list' };
    case 'found': {
      const { list } = read;
      if (known.status === 'known') {
        const held = { created_at: known.updatedAt, id: known.eventId ?? '' };
        // A seed or a list newer than any write relay holds: the read is stale.
        if (known.updatedAt > list.createdAt) return { step: 'wait', reason: 'newer-known' };
        if (known.updatedAt === list.createdAt) {
          if (known.eventId === undefined) return { step: 'wait', reason: 'same-second-unknown' };
          if (supersedes(held, { created_at: list.createdAt, id: list.id }))
            return { step: 'wait', reason: 'newer-known' };
        }
      }
      base = list;
      break;
    }
    case 'empty':
      // A list or seed was loaded for the account but no write relay has it.
      if (known.status === 'known') return { step: 'wait', reason: 'list-elsewhere' };
      if (input.indexed === undefined) return { step: 'ask-indexers' };
      if (input.indexed !== 'none') return { step: 'wait', reason: 'no-list' };
      base = EMPTY_LIST;
      break;
    default: {
      const unreachable: never = read;
      return unreachable;
    }
  }
  const tags = applyFollowIntents(base.tags, intents);
  const unchanged =
    tags.length === base.tags.length && tags.every((tag, index) => tag === base.tags[index]);
  return unchanged ? { step: 'already-applied' } : { step: 'publish', base, tags };
}

const ContactEvent = z.object({
  id: z.string(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  created_at: z.number().int().nonnegative(),
});

/** How far ahead of this device's clock a list may be dated, as for the mute list. */
const MAX_FUTURE_SEC = 60;

/**
 * Decode the read: a list only from a complete read, and only one that
 * parses and is not dated in the future (building on it would date ours there
 * too, and relays would keep it over every later list).
 */
function decodeRead(read: { outcome: OwnEventReadOutcome; newest: unknown }): ListRead {
  if (read.outcome !== 'complete') return { status: 'incomplete' };
  if (!read.newest) return { status: 'empty' };
  const parsed = ContactEvent.safeParse(read.newest);
  if (!parsed.success || parsed.data.created_at > Math.floor(Date.now() / 1000) + MAX_FUTURE_SEC)
    return { status: 'unusable' };
  const { tags, content, created_at, id } = parsed.data;
  return { status: 'found', list: { tags, content, createdAt: created_at, id } };
}

/**
 * The saved list fields. The store replaces at least one of them for every
 * list or seed it accepts, also one with the same `created_at`, so while they
 * are unchanged the list a publish builds on is still the newest known.
 */
function savedList() {
  const state = useNostrSocialStore.getState();
  return [
    state.contactsTags,
    state.contactsContent,
    state.contactsUpdatedAt,
    state.followingPubkeys,
  ] as const;
}

function sameSavedList(a: ReturnType<typeof savedList>, b: ReturnType<typeof savedList>) {
  return a.every((field, index) => field === b[index]);
}

/**
 * The list the store knows, before this read is kept. One from the same
 * second whose id the store does not know (it was loaded from storage) is
 * named as the read's list only when the store holds exactly the read's tags,
 * content and follows: building on the read then loses nothing it holds.
 */
function knownBefore(read: ListRead): ContactList {
  const state = useNostrSocialStore.getState();
  const known = selectContactList(state);
  if (known.status !== 'known' || known.eventId !== undefined || read.status !== 'found')
    return known;
  const { list } = read;
  const follows = new Set(list.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]));
  const followed = Object.keys(state.followingPubkeys);
  const holdsRead =
    known.updatedAt === list.createdAt &&
    state.contactsContent === list.content &&
    JSON.stringify(state.contactsTags) === JSON.stringify(list.tags) &&
    followed.length === follows.size &&
    followed.every((pubkey) => follows.has(pubkey));
  return holdsRead ? { ...known, eventId: list.id } : known;
}

/** Whether the account's write relays are still the ones `read` asked. */
function sameRelays(read: readonly string[], ownPubkey: string) {
  const now = getKnownOwnWriteRelays(ownPubkey);
  if (!now) return false;
  const asked = new Set(read);
  const current = new Set(now);
  return asked.size === current.size && [...asked].every((url) => current.has(url));
}

/**
 * How long to wait for the aggregate's last update. Each source still pending
 * at the data layer's bookkeeping ceiling is recorded as failed, so that
 * update comes by then; past it, and a margin, it is not coming.
 */
const INDEXERS_SETTLE_MS = tiers.DEFAULT_SOURCE_TIMEOUT_MS + 5_000;

/** `promise`'s value, or `undefined` once `ms` have passed without one. */
async function within<V>(promise: Promise<V>, ms: number): Promise<V | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the tiered facade whether the account has a follow list somewhere, once
 * every enabled source has settled. No source can prove there is none (nagg
 * answers "not served" for a list it lacks, the relay tier settles on a
 * majority of its relays), so this only holds a first follow back: `exists`
 * when any source returned a list, `unanswered` when one failed, the answer
 * says nothing about which sources settled or they did not all settle in
 * time, otherwise `none`.
 */
async function askIndexers(pubkey: string): Promise<{ indexed: IndexedList; seed?: () => void }> {
  const layer = buildNostrDataLayer();
  // No indexer is enabled: the write relays were every source there is.
  if (!layer) return { indexed: 'none' };
  // The aggregate resolves at its first paint; the last update says every source settled.
  let settle: (graph: facade.ResolvedSocialGraph) => void = () => undefined;
  const settled = new Promise<facade.ResolvedSocialGraph>((resolve) => (settle = resolve));
  const result = await layer.getSocialGraph({
    pubkey,
    refresh: true,
    onUpdate: (update) => {
      if (update.provenance?.complete) settle(update);
    },
  });
  if (result.isErr()) {
    const { attempts } = result.error;
    const noneServed =
      attempts.length > 0 && attempts.every((attempt) => attempt.outcome === 'unsupported');
    return { indexed: noneServed ? 'none' : 'unanswered' };
  }
  if (!result.value.provenance) return { indexed: 'unanswered' };
  const graph = result.value.provenance.complete
    ? result.value
    : await within(settled, INDEXERS_SETTLE_MS);
  if (!graph) return { indexed: 'unanswered' };
  if (graph.contactsUpdatedAt > 0)
    return {
      indexed: 'exists',
      seed: () =>
        useNostrSocialStore.getState().seedFollowsFromFacade({
          follows: graph.follows,
          createdAtSec: graph.contactsUpdatedAt,
        }),
    };
  return { indexed: graph.provenance?.degraded === false ? 'none' : 'unanswered' };
}

/** One pass for one account, with the account and its signer pinned across every wait. */
async function syncOnce(ndk: NDK, ownPubkey: string): Promise<void> {
  const scope = captureActiveProfile(ownPubkey);
  const social = () => useNostrSocialStore.getState();
  try {
    for (;;) {
      scope.check();
      if (!useNostrSocialStore.persist.hasHydrated()) return;
      if (Object.keys(selectFollowIntents(social())).length === 0) return;

      const signer = await matchingSigner(ndk, ownPubkey);
      scope.check();
      // Until the account's relay list is known its write relays read as the
      // defaults, which may not be where its follow list is.
      if (!getKnownOwnWriteRelays(ownPubkey)) {
        nostrLog.info('nostr.follow.waiting', { reason: 'relay-list-unknown' });
        return;
      }
      const raw = await readNewestOwnEvent(ndk, ownPubkey, Contacts);
      const read = decodeRead(raw);
      scope.check();

      let intents = selectFollowIntents(social());
      const planOf = (indexed?: IndexedList) => {
        intents = selectFollowIntents(social());
        return planFollowPublish({ intents, read, known: knownBefore(read), indexed });
      };
      let plan = planOf();
      if (plan.step === 'ask-indexers') {
        const answer = await askIndexers(ownPubkey);
        scope.check();
        answer.seed?.();
        plan = planOf(answer.indexed);
      }

      switch (plan.step) {
        case 'idle':
          return;
        case 'ask-indexers': // not returned once the indexers have answered
        case 'wait':
          nostrLog.info('nostr.follow.waiting', {
            reason: plan.step === 'wait' ? plan.reason : 'no-list',
            read: read.status,
            intents: Object.keys(intents).length,
          });
          return;
        case 'already-applied':
        case 'publish':
          break;
        default: {
          const unreachable: never = plan;
          throw new Error(`Unhandled follow plan ${String(unreachable)}`);
        }
      }

      // The plan stands on this read, so it is kept now, never before the plan:
      // the store takes it unless a list relays keep over it arrived meanwhile.
      if (read.status === 'found')
        social().setContactsFromRelay({
          tags: read.list.tags,
          content: read.list.content,
          createdAtSec: read.list.createdAt,
          eventId: read.list.id,
        });
      if (plan.step === 'already-applied') {
        social().settleFollowIntents(intents);
        continue;
      }
      const atBase = savedList();

      const event = new NDKEvent(ndk);
      event.kind = Contacts;
      event.pubkey = ownPubkey;
      event.created_at = Math.max(Math.floor(Date.now() / 1000), plan.base.createdAt + 1);
      event.tags = plan.tags;
      event.content = plan.base.content;
      // A signer replaced during the read never signs. Signing can fail but
      // never refuses (the only signer is the account's own key), so a
      // failure keeps the taps for the next pass.
      if (ndk.signer !== signer) throw new Error('Account signer changed');
      await event.sign(signer);
      scope.check();
      if (event.pubkey !== ownPubkey || ndk.signer !== signer)
        throw new Error('Account signer changed');
      // A list or seed arrived while signing, also one dated the same second,
      // or the write relays changed since the read: read and build again.
      if (!sameSavedList(atBase, savedList()) || !sameRelays(raw.relays, ownPubkey)) continue;

      // Exactly the relays the complete read covered: a relay that was not read
      // may hold a newer list, and this one would replace it there.
      const published = await publishEvent({
        ndk,
        event,
        relays: raw.relays,
        resolveOn: 'all-settled',
      });
      scope.check();
      if (published.isErr()) throw new Error(`Follow list publish failed: ${published.error.type}`);
      // Published, but not recorded for a signer that changed meanwhile: the next pass reads it back.
      if (ndk.signer !== signer) throw new Error('Account signer changed');
      nostrLog.info('nostr.follow.published', {
        intents: Object.keys(intents).length,
        tags: plan.tags.length,
      });
      // A list that arrived while publishing, also one from the same second
      // that relays prefer, may now be the newest: the taps stay until a
      // complete read returns a list that holds them.
      if (!sameSavedList(atBase, savedList())) continue;
      social().setContactsFromRelay({
        tags: plan.tags,
        content: plan.base.content,
        createdAtSec: event.created_at,
        eventId: event.id,
      });
      social().settleFollowIntents(intents);
    }
  } catch (error) {
    // The intents stay; the next trigger tries again.
    nostrLog.warn('nostr.follow.sync_failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  } finally {
    scope.dispose();
  }
}

type Worker = { ndk: NDK; again: boolean; done: Promise<void> };

/** At most one worker per account; a request while it runs makes it go round once more. */
const workers = new Map<string, Worker>();

/** Publish the account's outstanding follow intents. Resolves when its worker stops. */
export function requestFollowSync(ndk: NDK, ownPubkey: string): Promise<void> {
  const running = workers.get(ownPubkey);
  if (running) {
    running.ndk = ndk;
    running.again = true;
    return running.done;
  }
  const worker: Worker = { ndk, again: true, done: Promise.resolve() };
  workers.set(ownPubkey, worker);
  worker.done = (async () => {
    try {
      while (worker.again) {
        worker.again = false;
        await syncOnce(worker.ndk, ownPubkey);
      }
    } finally {
      workers.delete(ownPubkey);
    }
  })();
  return worker.done;
}
