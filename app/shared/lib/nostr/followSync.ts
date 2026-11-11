/**
 * Publishes the person's follow and unfollow taps, one follow list (kind 3)
 * at a time per account.
 *
 * A tap only records the intent (`setFollowIntent`), so the button answers at
 * once. This worker turns every outstanding intent into one list: it reads the
 * newest signed list from the write relays, applies only the intents to that
 * list's tags and content exactly as they are, publishes, and records the
 * result. A follow list replaces the whole previous one on relays, so it never
 * publishes from a list it cannot vouch for (`planFollowPublish`): without a
 * base the intents wait and are tried again after hydration, when a list
 * arrives, on returning to the foreground and on the next tap.
 *
 * Two devices publishing at the same moment can still overwrite each other;
 * that is how the list works on Nostr.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import { Contacts } from 'nostr-tools/kinds';
import { z } from 'zod';

import { nostrLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { paramPopup } from '@/shared/lib/popup';
import {
  selectContactList,
  selectFollowIntents,
  useNostrSocialStore,
  type ContactList,
} from '@/shared/stores/profile/nostrSocialStore';
import {
  captureProfile,
  matchingSigner,
  readNewestOwnEvent,
  type OwnEventReadOutcome,
} from './ownReplaceableEvent';
import { publishEvent } from './publish';

type FollowIntents = ReturnType<typeof selectFollowIntents>;

/** What the indexers (nagg, Primal, relay tier) say about the account's list. */
type IndexedList = 'none' | 'exists' | 'unanswered';

type Base = { tags: string[][]; content: string; updatedAt: number };

type FollowPlan =
  | { step: 'idle' }
  | { step: 'wait'; reason: 'no-list' | 'read-incomplete' }
  | { step: 'ask-indexers' }
  | { step: 'already-applied' }
  | { step: 'publish'; base: Base; tags: string[][] };

const EMPTY_LIST: Base = { tags: [], content: '', updatedAt: 0 };

/** The list's tags with only the intents applied; every other entry stays as read. */
export function applyFollowIntents(tags: string[][], intents: FollowIntents): string[][] {
  const listed = (pubkey: string) => tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey);
  const next = tags.filter((tag) => !(tag[0] === 'p' && intents[tag[1]]?.value === false));
  for (const [pubkey, intent] of Object.entries(intents))
    if (intent.value && !listed(pubkey)) next.push(['p', pubkey]);
  return next;
}

/**
 * Pure: what to do with the outstanding intents, given the list as the store
 * now holds it (after any read result was saved) and how the read ended.
 * Known-empty needs every write relay to have answered with no list, nothing
 * loaded from anywhere, and the indexers to agree.
 */
export function planFollowPublish(input: {
  intents: FollowIntents;
  list: ContactList;
  read: OwnEventReadOutcome;
  readFoundList: boolean;
  indexed?: IndexedList;
}): FollowPlan {
  const { intents, list } = input;
  if (Object.keys(intents).length === 0) return { step: 'idle' };
  let base: Base;
  switch (list.status) {
    case 'authoritative':
      base = list;
      break;
    case 'seeded':
      return { step: 'wait', reason: 'no-list' };
    case 'unknown':
      if (input.read !== 'complete' || input.readFoundList)
        return { step: 'wait', reason: 'read-incomplete' };
      if (input.indexed === undefined) return { step: 'ask-indexers' };
      if (input.indexed !== 'none') return { step: 'wait', reason: 'no-list' };
      base = EMPTY_LIST;
      break;
    default: {
      const unreachable: never = list;
      return unreachable;
    }
  }
  const tags = applyFollowIntents(base.tags, intents);
  const unchanged =
    tags.length === base.tags.length && tags.every((tag, index) => tag === base.tags[index]);
  return unchanged ? { step: 'already-applied' } : { step: 'publish', base, tags };
}

const ContactEvent = z.object({
  tags: z.array(z.array(z.string())),
  content: z.string(),
  created_at: z.number().int().nonnegative(),
});

/** Ask the tiered facade whether the account has a follow list somewhere. */
async function askIndexers(pubkey: string): Promise<{ indexed: IndexedList; seed?: () => void }> {
  const layer = buildNostrDataLayer();
  // No indexer is enabled: the write relays were every source there is.
  if (!layer) return { indexed: 'none' };
  const result = await layer.getSocialGraph({ pubkey, refresh: true });
  return result.match(
    (graph) =>
      graph.contactsUpdatedAt > 0
        ? {
            indexed: 'exists' as const,
            seed: () =>
              useNostrSocialStore.getState().seedFollowsFromFacade({
                follows: graph.follows,
                createdAtSec: graph.contactsUpdatedAt,
              }),
          }
        : { indexed: 'none' as const },
    () => ({ indexed: 'unanswered' as const })
  );
}

/** One pass for one account, with the account and its signer pinned across every wait. */
async function syncOnce(ndk: NDK, ownPubkey: string): Promise<void> {
  const scope = captureProfile(ownPubkey);
  const social = () => useNostrSocialStore.getState();
  try {
    for (;;) {
      scope.check();
      if (!useNostrSocialStore.persist.hasHydrated()) return;
      if (Object.keys(selectFollowIntents(social())).length === 0) return;

      const signer = await matchingSigner(ndk, ownPubkey);
      scope.check();
      const read = await readNewestOwnEvent(ndk, ownPubkey, Contacts);
      scope.check();
      const fetched = read.newest ? ContactEvent.safeParse(read.newest) : undefined;
      if (fetched?.success)
        social().setContactsFromRelay({
          tags: fetched.data.tags,
          content: fetched.data.content,
          createdAtSec: fetched.data.created_at,
        });

      let intents = selectFollowIntents(social());
      const planOf = (indexed?: IndexedList) => {
        intents = selectFollowIntents(social());
        return planFollowPublish({
          intents,
          list: selectContactList(social()),
          read: read.outcome,
          readFoundList: !!read.newest,
          indexed,
        });
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
            read: read.outcome,
            intents: Object.keys(intents).length,
          });
          return;
        case 'already-applied':
          social().settleFollowIntents(intents);
          continue;
        case 'publish':
          break;
        default: {
          const unreachable: never = plan;
          throw new Error(`Unhandled follow plan ${String(unreachable)}`);
        }
      }

      const stampAtBase = social().contactsUpdatedAt;
      const event = new NDKEvent(ndk);
      event.kind = Contacts;
      event.pubkey = ownPubkey;
      event.created_at = Math.max(Math.floor(Date.now() / 1000), plan.base.updatedAt + 1);
      event.tags = plan.tags;
      event.content = plan.base.content;
      try {
        await event.sign(signer);
      } catch (error) {
        scope.check();
        // The signer refused: these taps will not be published.
        nostrLog.warn('nostr.follow.sign_refused', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        social().settleFollowIntents(intents);
        paramPopup('engagement-update-failed', 'follow');
        return;
      }
      scope.check();
      if (event.pubkey !== ownPubkey || ndk.signer !== signer)
        throw new Error('Account signer changed');
      // A list arrived while signing: build again on it.
      if (social().contactsUpdatedAt !== stampAtBase) continue;

      const published = await publishEvent({ ndk, event, resolveOn: 'all-settled' });
      scope.check();
      if (published.isErr()) throw new Error(`Follow list publish failed: ${published.error.type}`);
      nostrLog.info('nostr.follow.published', {
        intents: Object.keys(intents).length,
        tags: plan.tags.length,
      });
      social().setContactsFromRelay({
        tags: plan.tags,
        content: plan.base.content,
        createdAtSec: event.created_at,
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
