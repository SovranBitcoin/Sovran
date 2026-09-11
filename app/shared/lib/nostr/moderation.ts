import NDK, { NDKEvent, NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk-mobile';
import { z } from 'zod';
import { useFeedIgnoreStore, normalizeIgnoreHex } from '@/features/feed/stores/ignoreStore';
import {
  changeMute,
  isNewerMuteList,
  reportTags,
  type MuteList,
  type ReportReason,
} from '@/features/feed/lib/moderation';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { publishEvent } from './publish';
import { getOwnWriteRelays } from './outbox/relayListStore';

const Tags = z.array(z.array(z.string())).max(20_000);
const queues = new WeakMap<NDK, Promise<unknown>>();

/** Watches transitions, including switching away and back while a signer is open. */
function captureProfile(pubkey: string) {
  const initial = useProfileStore.getState();
  let current =
    initial.profiles.find((p) => p.accountIndex === initial.activeAccountIndex)?.pubkey === pubkey;
  const dispose = useProfileStore.subscribe((state) => {
    if (
      state.activeAccountIndex !== initial.activeAccountIndex ||
      state.profiles.find((p) => p.accountIndex === state.activeAccountIndex)?.pubkey !== pubkey
    )
      current = false;
  });
  return {
    check: () => {
      if (!current) throw new Error('Profile changed');
    },
    dispose,
  };
}

function validMuteEvent(event: NDKEvent, pubkey: string): boolean {
  try {
    return (
      event.kind === 10000 &&
      event.pubkey === pubkey &&
      Number.isSafeInteger(event.created_at) &&
      (event.created_at ?? -1) >= 0 &&
      event.id === event.getEventHash() &&
      event.verifySignature(false) === true
    );
  } catch {
    return false;
  }
}

async function matchingSigner(ndk: NDK, pubkey: string) {
  const signer = ndk.signer;
  if (!signer || (await signer.user()).pubkey !== pubkey || ndk.signer !== signer)
    throw new Error('Account signer is not ready');
  return signer;
}

export async function decodeMuteList(ndk: NDK, event: NDKEvent, pubkey: string): Promise<MuteList> {
  if (!validMuteEvent(event, pubkey)) throw new Error('Invalid mute list');
  if (event.content.length > 1_000_000 || event.created_at! > Math.floor(Date.now() / 1000) + 60)
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

/** Fetch before editing a replaceable event; never replace unreadable encrypted entries. */
async function readMuteList(ndk: NDK, pubkey: string): Promise<MuteList | null> {
  const relayUrls = [...new Set(getOwnWriteRelays())];
  if (relayUrls.length === 0) throw new Error('No mute-list relays configured');
  const latest = await new Promise<NDKEvent | undefined>((resolve, reject) => {
    let newest: NDKEvent | undefined;
    let settled = false;
    const pending = new Set(relayUrls);
    const subscriptions: ReturnType<NDK['subscribe']>[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.stop();
      if (error) reject(error);
      else resolve(newest);
    };
    const timer = setTimeout(() => finish(new Error('Mute-list read timed out')), 12_000);
    try {
      for (const url of relayUrls) {
        // A multi-relay NDK subscription may emit EOSE before all relays finish,
        // and emits it only once. Independent reads require every relay's actual
        // response before a replaceable list can safely be edited.
        const relays = NDKRelaySet.fromRelayUrls([url], ndk);
        const subscription = ndk.subscribe(
          { kinds: [10000], authors: [pubkey] },
          { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, closeOnEose: false },
          relays,
          false
        );
        subscriptions.push(subscription);
        subscription.on('event', (event: NDKEvent) => {
          if (settled || !validMuteEvent(event, pubkey)) return;
          if (
            !newest ||
            event.created_at! > newest.created_at! ||
            (event.created_at === newest.created_at && event.id < newest.id)
          )
            newest = event;
        });
        subscription.on('eose', () => {
          if (![...relays.relays].every((relay) => subscription.eosesSeen.has(relay))) return;
          pending.delete(url);
          if (pending.size === 0) finish();
        });
        void subscription.start().catch(() => finish(new Error('Mute-list subscription failed')));
      }
    } catch {
      finish(new Error('Mute-list subscription failed'));
    }
  });
  return latest ? decodeMuteList(ndk, latest, pubkey) : null;
}

export async function syncMuteList(ndk: NDK, pubkey: string): Promise<void> {
  const scope = captureProfile(pubkey);
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
  const scope = captureProfile(ownPubkey);
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
      const fetched = await readMuteList(ndk, ownPubkey);
      scope.check();
      const cached = useFeedIgnoreStore.getState().muteList;
      const base = (fetched && isNewerMuteList(fetched, cached) ? fetched : cached) ?? {
        id: '',
        createdAt: 0,
        tags: [],
        privateTags: [],
      };
      // readMuteList only returns empty after the configured relays answer;
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
      const event = new NDKEvent(ndk);
      event.kind = 10000;
      event.pubkey = ownPubkey;
      event.created_at = Math.max(Math.floor(Date.now() / 1000), base.createdAt + 1);
      event.tags = next.tags;
      event.content = content;
      await event.sign(signer);
      scope.check();
      if (event.pubkey !== ownPubkey || ndk.signer !== signer)
        throw new Error('Account signer changed');
      const latestKnown = useFeedIgnoreStore.getState().muteList;
      if (latestKnown && isNewerMuteList(latestKnown, base))
        throw new Error('Mute list changed; retry sync');
      const published = await publishEvent({
        ndk,
        event,
        relays: getOwnWriteRelays(),
        resolveOn: 'all-settled',
      });
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
  target: string,
  reason: ReportReason,
  publicEventId?: string
): Promise<void> {
  const scope = captureProfile(ownPubkey);
  try {
    scope.check();
    const event = new NDKEvent(ndk);
    event.kind = 1984;
    event.pubkey = ownPubkey;
    event.tags = reportTags(target, reason, publicEventId);
    event.content = '';
    const signer = await matchingSigner(ndk, ownPubkey);
    scope.check();
    await event.sign(signer);
    scope.check();
    if (event.pubkey !== ownPubkey || ndk.signer !== signer)
      throw new Error('Account signer changed');
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
