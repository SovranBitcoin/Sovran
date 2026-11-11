/**
 * Reading and replacing one of the account's own replaceable lists (the mute
 * list, the follow list) without losing what another client wrote: read the
 * newest signed copy from every write relay, and hold the account and its
 * signer fixed across each wait so a switch never writes to the wrong account.
 */
import NDK, { NDKEvent, NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk-mobile';
import { getOwnWriteRelays } from './outbox/relayListStore';

const READ_TIMEOUT_MS = 12_000;

/** Signed by `pubkey`, of `kind`, with an id and signature that verify. */
export function validOwnEvent(event: NDKEvent, pubkey: string, kind: number): boolean {
  try {
    return (
      event.kind === kind &&
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

export async function matchingSigner(ndk: NDK, pubkey: string) {
  const signer = ndk.signer;
  if (!signer || (await signer.user()).pubkey !== pubkey || ndk.signer !== signer)
    throw new Error('Account signer is not ready');
  return signer;
}

/**
 * How a read ended. Only `complete` means every asked relay answered, so only
 * then does a missing `newest` say the relays hold no such list.
 */
export type OwnEventReadOutcome = 'complete' | 'timed-out' | 'failed' | 'no-relays';

type OwnEventRead = {
  outcome: OwnEventReadOutcome;
  /** The newest valid event any relay returned, also when the read did not complete. */
  newest: NDKEvent | undefined;
  /** The relays asked: on `complete`, every one of them answered. */
  relays: string[];
};

/**
 * Newest valid own event of `kind` across `asked` (the write relays unless
 * named), waiting for each relay's answer. The device cache is never read.
 */
export async function readNewestOwnEvent(
  ndk: NDK,
  pubkey: string,
  kind: number,
  asked: readonly string[] = getOwnWriteRelays()
): Promise<OwnEventRead> {
  const relayUrls = [...new Set(asked)];
  if (relayUrls.length === 0) return { outcome: 'no-relays', newest: undefined, relays: [] };
  return new Promise<OwnEventRead>((resolve) => {
    let newest: NDKEvent | undefined;
    let settled = false;
    const pending = new Set(relayUrls);
    const subscriptions: ReturnType<NDK['subscribe']>[] = [];
    const finish = (outcome: OwnEventReadOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.stop();
      resolve({ outcome, newest, relays: relayUrls });
    };
    const timer = setTimeout(() => finish('timed-out'), READ_TIMEOUT_MS);
    try {
      for (const url of relayUrls) {
        // A multi-relay NDK subscription may emit EOSE before all relays finish,
        // and emits it only once. Independent reads require every relay's actual
        // response before a replaceable list can safely be edited.
        const relays = NDKRelaySet.fromRelayUrls([url], ndk);
        const subscription = ndk.subscribe(
          { kinds: [kind], authors: [pubkey] },
          { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, closeOnEose: false },
          relays,
          false
        );
        subscriptions.push(subscription);
        subscription.on('event', (event: NDKEvent) => {
          if (settled || !validOwnEvent(event, pubkey, kind)) return;
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
          if (pending.size === 0) finish('complete');
        });
        void subscription.start().catch(() => finish('failed'));
      }
    } catch {
      finish('failed');
    }
  });
}
