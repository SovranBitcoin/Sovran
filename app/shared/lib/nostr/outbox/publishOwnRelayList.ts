/**
 * @fileoverview Publishes the active profile's NIP-65 relay list, for both
 * the first-run publish of the defaults and Network settings.
 *
 * The relay list follows the rule of every own list (`ownReplaceableEvent`):
 * read the newest copy completely, date the new one after it, send it to
 * exactly the relays read, wait when that cannot be done. It is special in
 * that it defines the relay set, so it is read from where it can be: the
 * saved write relays (where another client would have put it), the defaults
 * (where this app puts it) and every relay this session's discovery asked
 * (`relayListRelays`). Sending it to all of those reaches the old write
 * relays and the new ones alike, so both sides learn of the change.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { err, ok, type Result } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import { DEFAULT_RELAYS, normalizeRelayList } from '@/shared/lib/nostr/outbox/defaults';
import {
  RELAY_LIST_KIND,
  serializeRelayList,
  parseRelayList,
  type RelayListEntry,
} from '@/shared/lib/nostr/outbox/nip65';
import {
  defaultEntries,
  getOwnWriteRelays,
  useRelayListStore,
} from '@/shared/lib/nostr/outbox/relayListStore';
import {
  matchingSigner,
  publishToRelaysRead,
  readForEdit,
  signReplacement,
  type ReadForEdit,
} from '@/shared/lib/nostr/ownReplaceableEvent';
import { captureActiveProfile } from '@/shared/stores/global/profileStore';

/** The relays this session's discovery for the account has asked, while it runs. */
let discovery: {
  pubkey: string;
  asked: ReadonlySet<string>;
  learned: ReadonlySet<string>;
} | null = null;

/**
 * Track discovery's queried relays and separately its learned write relays.
 * Learned means eligible for the next edit's read, never already queried.
 */
export function trackRelaysAsked(
  pubkey: string,
  asked: ReadonlySet<string>,
  learned: ReadonlySet<string> = new Set()
): () => void {
  discovery = { pubkey, asked, learned };
  return () => {
    if (discovery?.asked === asked) discovery = null;
  };
}

/**
 * Where the account's relay list is read: its saved write relays, the
 * defaults and every relay this session's discovery asked or learned. A store that has
 * not loaded has no saved relays to name, so nothing is read yet.
 */
export function relayListRelays(pubkey: string): string[] | null {
  if (!useRelayListStore.persist.hasHydrated()) return null;
  const tracked = discovery?.pubkey === pubkey ? discovery : null;
  return normalizeRelayList([
    ...getOwnWriteRelays(),
    ...DEFAULT_RELAYS,
    ...(tracked?.asked ?? []),
    ...(tracked?.learned ?? []),
  ]);
}

type CompleteRead = Extract<ReadForEdit, { status: 'read' }>;
type RelayListPublishError =
  | { type: 'no-write-relay' }
  | { type: 'waiting' }
  | { type: 'changed' }
  | { type: 'failed'; cause?: unknown };
type PublishResult = Result<{ accepted: number }, RelayListPublishError>;

export type RelayListReview = {
  readonly base: readonly RelayListEntry[];
  readonly entries: readonly RelayListEntry[];
  publish: () => Promise<PublishResult>;
};
export type RelayListEditor = {
  readonly base: readonly RelayListEntry[];
  readonly savedProposal: readonly RelayListEntry[] | null;
  review: (entries: readonly RelayListEntry[]) => RelayListReview;
  dispose: () => void;
};

const snapshot = (entries: readonly RelayListEntry[]) =>
  Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
const entriesFrom = (read: CompleteRead) =>
  read.newest ? parseRelayList(read.newest) : defaultEntries();
const sameBase = (a: CompleteRead, b: CompleteRead) =>
  a.newest?.id === b.newest?.id &&
  JSON.stringify([...a.relays].sort()) === JSON.stringify([...b.relays].sort()) &&
  JSON.stringify([...a.asked].sort()) === JSON.stringify([...b.asked].sort());

// Read newly learned destinations too, before offering a base for review.
async function readRelayBase(
  ndk: NDK,
  pubkey: string,
  proposed: readonly RelayListEntry[] = [],
  previous: readonly string[] = []
) {
  const known = relayListRelays(pubkey);
  if (!known) return { status: 'waiting', reason: 'relay-list-unknown' } satisfies ReadForEdit;
  let relays = normalizeRelayList([
    ...known,
    ...previous,
    ...proposed.filter((e) => e.write).map((e) => e.url),
  ]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const read = await readForEdit(ndk, pubkey, RELAY_LIST_KIND, relays);
    if (read.status === 'waiting') return read;
    const learned = entriesFrom(read)
      .filter((e) => e.write)
      .map((e) => e.url);
    const expanded = normalizeRelayList([...relays, ...learned]);
    if (expanded.length === relays.length) return read;
    relays = expanded;
  }
  return { status: 'waiting', reason: 'relay-list-unknown' } satisfies ReadForEdit;
}

const publishing = new WeakMap<NDK, Set<string>>();
async function exclusively(
  ndk: NDK,
  pubkey: string,
  run: () => Promise<PublishResult>
): Promise<PublishResult> {
  const active = publishing.get(ndk) ?? new Set<string>();
  if (active.has(pubkey)) return err({ type: 'waiting' });
  publishing.set(ndk, active);
  active.add(pubkey);
  try {
    return await run();
  } finally {
    active.delete(pubkey);
  }
}

/** A complete read starts an ephemeral edit. No toggle writes the saved store. */
export async function beginRelayListEdit(
  ndk: NDK,
  pubkey: string
): Promise<Result<RelayListEditor, RelayListPublishError>> {
  const scope = captureActiveProfile(pubkey);
  const held = useRelayListStore.getState().entries;
  const updatedAt = useRelayListStore.getState().updatedAt;
  const destinations = relayListRelays(pubkey);
  const savedProposal = useRelayListStore.getState().source === 'local' ? snapshot(held) : null;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    scope.dispose();
  };
  const wanted = () =>
    !disposed &&
    useRelayListStore.getState().entries === held &&
    useRelayListStore.getState().updatedAt === updatedAt;
  try {
    const signer = await matchingSigner(ndk, pubkey);
    scope.check();
    if (!destinations || !wanted()) {
      dispose();
      return err({ type: 'waiting' });
    }
    const base = await readRelayBase(ndk, pubkey, [], destinations);
    scope.check();
    if (base.status === 'waiting' || !wanted() || ndk.signer !== signer) {
      dispose();
      return err({ type: 'waiting' });
    }
    // Keep only complete reads in the session. Each review owns immutable copies.
    let current: CompleteRead = base;
    let revision = 0;
    const editor: RelayListEditor = {
      get base() {
        return snapshot(entriesFrom(current));
      },
      savedProposal,
      dispose,
      review(entries) {
        const reviewed = current;
        const approvedRevision = ++revision;
        const proposal = snapshot(entries.filter((e) => e.read || e.write));
        let consumed = false;
        return {
          base: snapshot(entriesFrom(reviewed)),
          entries: proposal,
          publish: () =>
            exclusively(ndk, pubkey, async () => {
              if (consumed) return err({ type: 'waiting' });
              consumed = true;
              const valid = () =>
                wanted() && approvedRevision === revision && ndk.signer === signer;
              try {
                scope.check();
                if (!valid()) return err({ type: 'waiting' });
                if (!proposal.some((e) => e.write)) return err({ type: 'no-write-relay' });
                const fresh = await readRelayBase(ndk, pubkey, proposal, reviewed.asked);
                scope.check();
                if (fresh.status === 'waiting' || !valid()) return err({ type: 'waiting' });
                // New proposed destinations must also have answered before signing;
                // their absence from the original read alone does not change its base.
                if (
                  fresh.newest?.id !== reviewed.newest?.id ||
                  reviewed.asked.some((url) => !fresh.asked.includes(url)) ||
                  reviewed.relays.some((url) => !fresh.relays.includes(url))
                ) {
                  current = fresh;
                  return err({ type: 'changed' });
                }
                const event = await signReplacement(ndk, signer, scope, {
                  kind: RELAY_LIST_KIND,
                  pubkey,
                  replaces: Math.max(updatedAt, fresh.newest?.created_at ?? 0),
                  tags: serializeRelayList(proposal),
                  content: '',
                });
                scope.check();
                if (!valid()) return err({ type: 'waiting' });
                const afterSign = await readRelayBase(ndk, pubkey, proposal, fresh.asked);
                scope.check();
                if (afterSign.status === 'waiting' || !valid()) return err({ type: 'waiting' });
                if (!sameBase(fresh, afterSign)) {
                  current = afterSign;
                  return err({ type: 'changed' });
                }
                const published = await publishToRelaysRead(ndk, event, afterSign.relays);
                scope.check();
                if (!valid()) return err({ type: 'failed' });
                if (published.isErr()) return err({ type: 'failed', cause: published.error });
                useRelayListStore.getState().markPublished(event.created_at, [...proposal]);
                scope.check();
                if (ndk.signer !== signer) return err({ type: 'failed' });
                useRelayListStore.getState().markDiscovered(pubkey);
                return ok({ accepted: published.value.accepted.length });
              } catch (cause) {
                return err({ type: 'failed', cause });
              }
            }),
        };
      },
    };
    return ok(editor);
  } catch (cause) {
    dispose();
    return err({ type: 'failed', cause });
  }
}

/** First run can only publish defaults, after discovery proved no list exists. */
export async function publishDefaultRelayList(
  ndk: NDK,
  pubkey: string,
  read: CompleteRead,
  stillWanted: () => boolean
): Promise<PublishResult> {
  return exclusively(ndk, pubkey, async () => {
    const scope = captureActiveProfile(pubkey);
    const held = useRelayListStore.getState().entries;
    const wanted = () => {
      const state = useRelayListStore.getState();
      return (
        stillWanted() && state.entries === held && !state.hasPublished && state.source !== 'local'
      );
    };
    try {
      if (read.newest || !wanted()) return err({ type: 'waiting' });
      const signer = await matchingSigner(ndk, pubkey);
      scope.check();
      if (!wanted()) return err({ type: 'waiting' });
      const fresh = await readRelayBase(ndk, pubkey, [], read.asked);
      scope.check();
      if (fresh.status === 'waiting' || fresh.newest || !wanted() || ndk.signer !== signer)
        return err({ type: 'waiting' });
      const entries = defaultEntries();
      const event = await signReplacement(ndk, signer, scope, {
        kind: RELAY_LIST_KIND,
        pubkey,
        tags: serializeRelayList(entries),
        content: '',
      });
      scope.check();
      if (!wanted() || ndk.signer !== signer) return err({ type: 'waiting' });
      const afterSign = await readRelayBase(ndk, pubkey, [], fresh.asked);
      scope.check();
      if (
        afterSign.status === 'waiting' ||
        !sameBase(fresh, afterSign) ||
        !wanted() ||
        ndk.signer !== signer
      )
        return err({ type: 'waiting' });
      const published = await publishToRelaysRead(ndk, event, afterSign.relays);
      scope.check();
      if (ndk.signer !== signer || !wanted()) return err({ type: 'failed' });
      if (published.isErr()) return err({ type: 'failed', cause: published.error });
      useRelayListStore.getState().markPublished(event.created_at, entries);
      return ok({ accepted: published.value.accepted.length });
    } catch (cause) {
      nostrLog.warn('nostr.relays.publish_failed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return err({ type: 'failed', cause });
    } finally {
      scope.dispose();
    }
  });
}
