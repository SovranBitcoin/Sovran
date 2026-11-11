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
  type RelayListEntry,
} from '@/shared/lib/nostr/outbox/nip65';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import {
  matchingSigner,
  publishToRelaysRead,
  readForEdit,
  signReplacement,
  type ReadForEdit,
} from '@/shared/lib/nostr/ownReplaceableEvent';
import { captureActiveProfile } from '@/shared/stores/global/profileStore';

/** The relays this session's discovery for the account has asked, while it runs. */
let discovery: { pubkey: string; asked: ReadonlySet<string> } | null = null;

/** Discovery for `pubkey` has asked `asked` (it only grows). Returns the undo. */
export function trackRelaysAsked(pubkey: string, asked: ReadonlySet<string>): () => void {
  discovery = { pubkey, asked };
  return () => {
    if (discovery?.asked === asked) discovery = null;
  };
}

/**
 * Where the account's relay list is read: its saved write relays, the
 * defaults and every relay this session's discovery asked. A store that has
 * not loaded has no saved relays to name, so nothing is read yet.
 */
export function relayListRelays(pubkey: string): string[] | null {
  if (!useRelayListStore.persist.hasHydrated()) return null;
  const asked = discovery?.pubkey === pubkey ? discovery.asked : [];
  return normalizeRelayList([...getOwnWriteRelays(), ...DEFAULT_RELAYS, ...asked]);
}

type RelayListPublishError =
  /** Not a list to publish: it has no relay to write to. */
  | { type: 'no-write-relay' }
  /** The relays could not all be read; nothing was sent. */
  | { type: 'waiting' }
  | { type: 'failed'; cause?: unknown };

/**
 * Publish `entries` as the account's relay list. Recorded as the saved list
 * (`markPublished`) only once a relay accepted it, and only while the list
 * held is still the one this started from: an edit made meanwhile stays
 * unpublished. A list with no relay to write to is refused: others would
 * read that the account has none, while this app writes to the defaults.
 *
 * `read` is a complete read just made (the first-run publish passes
 * discovery's); otherwise the relays are read here first.
 */
export async function publishOwnRelayList(
  ndk: NDK,
  pubkey: string,
  entries: readonly RelayListEntry[],
  options: { read?: Extract<ReadForEdit, { status: 'read' }>; stillWanted?: () => boolean } = {}
): Promise<Result<{ accepted: number }, RelayListPublishError>> {
  if (!entries.some((entry) => entry.write)) return err({ type: 'no-write-relay' });
  const scope = captureActiveProfile(pubkey);
  try {
    const signer = await matchingSigner(ndk, pubkey);
    scope.check();
    const held = useRelayListStore.getState().entries;
    const read =
      options.read ?? (await readForEdit(ndk, pubkey, RELAY_LIST_KIND, relayListRelays(pubkey)));
    scope.check();
    if (read.status === 'waiting') {
      nostrLog.info('nostr.relays.publish_waiting', { reason: read.reason });
      return err({ type: 'waiting' });
    }
    const event = await signReplacement(ndk, signer, scope, {
      kind: RELAY_LIST_KIND,
      pubkey,
      // After the newest list the relays hold and the one saved here.
      replaces: Math.max(useRelayListStore.getState().updatedAt, read.newest?.created_at ?? 0),
      tags: serializeRelayList(entries),
      content: '',
    });
    const published = await publishToRelaysRead(ndk, event, read.relays);
    scope.check();
    if (published.isErr()) return err({ type: 'failed', cause: published.error });
    const accepted = published.value.accepted.length;
    nostrLog.info('nostr.relays.published', { accepted, relays: read.relays.length });
    if (useRelayListStore.getState().entries === held && (options.stillWanted?.() ?? true))
      useRelayListStore.getState().markPublished(event.created_at, [...entries]);
    return ok({ accepted });
  } catch (cause) {
    nostrLog.warn('nostr.relays.publish_failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return err({ type: 'failed', cause });
  } finally {
    scope.dispose();
  }
}

/** Network settings' "Publish relay list", with what the screen shows while and after. */
export async function publishRelayList(ctx: {
  ndk: NDK;
  pubkey: string;
  entries: readonly RelayListEntry[];
  setPublishing: (publishing: boolean) => void;
  setPublishMsg: (msg: string | null) => void;
}): Promise<void> {
  const { ndk, pubkey, entries, setPublishing, setPublishMsg } = ctx;
  setPublishing(true);
  setPublishMsg(null);
  try {
    const result = await publishOwnRelayList(ndk, pubkey, entries);
    if (result.isOk()) setPublishMsg(`Published to ${result.value.accepted} relays.`);
    else if (result.error.type === 'no-write-relay')
      setPublishMsg('Add a relay to write to, or restore defaults.');
    else setPublishMsg('Could not publish. Check your connection and try again.');
  } finally {
    setPublishing(false);
  }
}
