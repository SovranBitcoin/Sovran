import NDK, { type NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import { z } from 'zod';
import { useFeedIgnoreStore, normalizeIgnoreHex } from '@/features/feed/stores/ignoreStore';
import {
  changeMute,
  isNewerMuteList,
  reportTags,
  type MuteList,
  type ReportReason,
} from '@/features/feed/lib/moderation';
import type { NostrEventId, NostrPubkeyHex } from '@/shared/lib/protocolIds';
import { captureActiveProfile } from '@/shared/stores/global/profileStore';
import {
  MAX_FUTURE_SEC,
  matchingSigner,
  publishToRelaysRead,
  readForEdit,
  readNewestOwnEvent,
  signOwnEvent,
  signReplacement,
  validOwnEvent,
  type ReadForEdit,
} from './ownReplaceableEvent';
import { publishEvent } from './publish';
import { getOwnWriteRelays } from './outbox/relayListStore';

const Tags = z.array(z.array(z.string())).max(20_000);
const queues = new WeakMap<NDK, Promise<unknown>>();

export async function decodeMuteList(ndk: NDK, event: NDKEvent, pubkey: string): Promise<MuteList> {
  if (!validOwnEvent(event, pubkey, 10000)) throw new Error('Invalid mute list');
  if (
    event.content.length > 1_000_000 ||
    event.created_at! > Math.floor(Date.now() / 1000) + MAX_FUTURE_SEC
  )
    throw new Error('Unsupported mute list');
  let privateTags: string[][] = [];
  if (event.content) {
    const signer = await matchingSigner(ndk, pubkey);
    const plaintext = await signer.decrypt(
      ndk.getUser({ pubkey }),
      event.content,
      event.content.includes('?iv=') ? 'nip04' : 'nip44'
    );
    privateTags = Tags.parse(JSON.parse(plaintext));
  }
  return { id: event.id, createdAt: event.created_at!, tags: Tags.parse(event.tags), privateTags };
}

const WAITING: Record<Extract<ReadForEdit, { status: 'waiting' }>['reason'], string> = {
  'relay-list-unknown': 'Mute-list relays not known yet',
  'no-relays': 'No mute-list relays configured',
  'timed-out': 'Mute-list read timed out',
  failed: 'Mute-list subscription failed',
};

/** Restore the list from the write relays held now, waiting for each of them. */
async function readMuteList(ndk: NDK, pubkey: string): Promise<MuteList | null> {
  const read = await readNewestOwnEvent(ndk, pubkey, 10000);
  if (read.outcome !== 'complete') throw new Error(WAITING[read.outcome]);
  return read.newest ? decodeMuteList(ndk, read.newest, pubkey) : null;
}

export async function syncMuteList(ndk: NDK, pubkey: string): Promise<void> {
  const scope = captureActiveProfile(pubkey);
  try {
    if (!useFeedIgnoreStore.persist.hasHydrated())
      throw new Error('Moderation preferences are loading');
    scope.check();
    await matchingSigner(ndk, pubkey);
    scope.check();
    const list = await readMuteList(ndk, pubkey);
    scope.check();
    if (list) useFeedIgnoreStore.getState().receiveMuteList(list);
  } finally {
    scope.dispose();
  }
}

/** Local protection is immediate and stays in place if relay synchronization fails. */
export class BlockSyncError extends Error {}

export function setPersonBlocked(
  ndk: NDK,
  ownPubkey: string,
  target: string,
  blocked: boolean
): Promise<void> {
  const pubkey = normalizeIgnoreHex(target);
  if (!pubkey || pubkey === ownPubkey) return Promise.reject(new Error('Invalid block target'));
  const scope = captureActiveProfile(ownPubkey);
  try {
    scope.check();
  } catch (error) {
    scope.dispose();
    return Promise.reject(error);
  }
  try {
    if (!useFeedIgnoreStore.persist.hasHydrated())
      throw new Error('Moderation preferences are loading');
    const store = useFeedIgnoreStore.getState();
    if (blocked) store.ignorePubkey(pubkey);
    else store.unignorePubkey(pubkey);
  } catch (error) {
    scope.dispose();
    return Promise.reject(error);
  }
  const work = (queues.get(ndk) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      scope.check();
      const signer = await matchingSigner(ndk, ownPubkey);
      scope.check();
      // The edit waits until this session knows the account's relays and has
      // read them all, a relay silent read after read left out.
      const read = await readForEdit(ndk, ownPubkey, 10000);
      scope.check();
      if (read.status === 'waiting') throw new Error(WAITING[read.reason]);
      // Never replace unreadable encrypted entries.
      const fetched = read.newest ? await decodeMuteList(ndk, read.newest, ownPubkey) : null;
      scope.check();
      const cached = useFeedIgnoreStore.getState().muteList;
      const base = (fetched && isNewerMuteList(fetched, cached) ? fetched : cached) ?? {
        id: '',
        createdAt: 0,
        tags: [],
        privateTags: [],
      };
      // `fetched` is empty only after every relay read answered;
      // a timeout or unreadable list must never create a replacement.
      if (fetched) useFeedIgnoreStore.getState().receiveMuteList(fetched);
      let next = base;
      for (const key of useFeedIgnoreStore.getState().ignoredPubkeys)
        next = changeMute(next, key, true);
      const overrides = useFeedIgnoreStore.getState().blockOverrides;
      for (const [key, value] of Object.entries(overrides)) next = changeMute(next, key, value);
      const content = await signer.encrypt(
        ndk.getUser({ pubkey: ownPubkey }),
        JSON.stringify(next.privateTags),
        'nip44'
      );
      scope.check();
      const event = await signReplacement(ndk, signer, scope, {
        kind: 10000,
        pubkey: ownPubkey,
        replaces: base.createdAt,
        tags: next.tags,
        content,
      });
      const latestKnown = useFeedIgnoreStore.getState().muteList;
      if (latestKnown && isNewerMuteList(latestKnown, base))
        throw new Error('Mute list changed; retry sync');
      const published = await publishToRelaysRead(ndk, event, read.relays);
      scope.check();
      if (published.isErr()) throw new Error('No relay accepted the mute list');
      const accepted = {
        id: event.id,
        createdAt: event.created_at,
        tags: event.tags,
        privateTags: next.privateTags,
      };
      useFeedIgnoreStore.getState().receiveMuteList(accepted, overrides);
    })
    .catch((cause: unknown) => {
      throw new BlockSyncError(
        cause instanceof Error ? cause.message : 'Block synchronization failed',
        { cause }
      );
    })
    .finally(scope.dispose);
  queues.set(ndk, work);
  return work;
}

export async function publishReport(
  ndk: NDK,
  ownPubkey: string,
  target: NostrPubkeyHex,
  reason: ReportReason,
  publicEventId?: NostrEventId
): Promise<void> {
  const scope = captureActiveProfile(ownPubkey);
  try {
    scope.check();
    const tags = reportTags(target, reason, publicEventId);
    const signer = await matchingSigner(ndk, ownPubkey);
    scope.check();
    const event = await signOwnEvent(ndk, signer, scope, {
      kind: 1984,
      pubkey: ownPubkey,
      tags,
      content: '',
    });
    const result = await publishEvent({
      ndk,
      event,
      relays: getOwnWriteRelays(),
      resolveOn: 'all-settled',
    });
    scope.check();
    if (result.isErr()) throw new Error('No relay accepted the report');
  } finally {
    scope.dispose();
  }
}
