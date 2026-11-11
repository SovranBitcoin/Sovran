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
import type { facade } from 'nostr';
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

/** A follow list as signed: the base a publish builds on. */
type ReadList = { tags: string[][]; content: string; createdAt: number };

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
      reason: 'read-incomplete' | 'unusable-list' | 'newer-known' | 'list-elsewhere' | 'no-list';
    }
  | { step: 'ask-indexers' }
  | { step: 'already-applied' }
  | { step: 'publish'; base: ReadList; tags: string[][] };

const EMPTY_LIST: ReadList = { tags: [], content: '', createdAt: 0 };

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
 * the list the store knows (after a complete read's list was saved). Both a
 * publish and settling a tap the list already holds stand only on the list a
 * complete read returned. Known-empty needs every write relay to have
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
    case 'found':
      // A seed or a list newer than any write relay holds: the read is stale.
      if (known.status === 'known' && known.updatedAt > read.list.createdAt)
        return { step: 'wait', reason: 'newer-known' };
      base = read.list;
      break;
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
  tags: z.array(z.array(z.string())),
  content: z.string(),
  created_at: z.number().int().nonnegative(),
});

/** Decode the read: a list only from a complete read, and only one that parses. */
function decodeRead(read: { outcome: OwnEventReadOutcome; newest: unknown }): ListRead {
  if (read.outcome !== 'complete') return { status: 'incomplete' };
  if (!read.newest) return { status: 'empty' };
  const parsed = ContactEvent.safeParse(read.newest);
  if (!parsed.success) return { status: 'unusable' };
  const { tags, content, created_at } = parsed.data;
  return { status: 'found', list: { tags, content, createdAt: created_at } };
}

/**
 * Ask the tiered facade whether the account has a follow list somewhere, once
 * every enabled source has settled. No source can prove there is none (nagg
 * answers "not served" for a list it lacks, the relay tier settles on a
 * majority of its relays), so this only holds a first follow back: `exists`
 * when any source returned a list, `unanswered` when one failed or the
 * answer says nothing about which sources settled, otherwise `none`.
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
  const graph = result.value.provenance.complete ? result.value : await settled;
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
  const scope = captureProfile(ownPubkey);
  const social = () => useNostrSocialStore.getState();
  try {
    for (;;) {
      scope.check();
      if (!useNostrSocialStore.persist.hasHydrated()) return;
      if (Object.keys(selectFollowIntents(social())).length === 0) return;

      const signer = await matchingSigner(ndk, ownPubkey);
      scope.check();
      const read = decodeRead(await readNewestOwnEvent(ndk, ownPubkey, Contacts));
      scope.check();
      // Only a complete read's list is kept; the store ignores it if it knows a newer one.
      if (read.status === 'found')
        social().setContactsFromRelay({
          tags: read.list.tags,
          content: read.list.content,
          createdAtSec: read.list.createdAt,
        });

      let intents = selectFollowIntents(social());
      const planOf = (indexed?: IndexedList) => {
        intents = selectFollowIntents(social());
        return planFollowPublish({
          intents,
          read,
          known: selectContactList(social()),
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
            read: read.status,
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
      event.created_at = Math.max(Math.floor(Date.now() / 1000), plan.base.createdAt + 1);
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
