import NDK, {
  NDKEvent,
  NDKRelaySet,
  normalizeRelayUrl,
  type NDKFilter,
  type NDKKind,
  type NDKSubscription,
  type NostrEvent as NDKNostrEvent,
} from '@nostr-dev-kit/ndk-mobile';
import type {
  NostrNetworkInterface,
  PublishResponse,
  Subscribable,
  Unsubscribable,
} from '@internet-privacy/marmot-ts';

type ApplesauceFilter = Parameters<NostrNetworkInterface['request']>[1];
type ApplesauceEvent = Awaited<ReturnType<NostrNetworkInterface['request']>>[number];

const KEY_PACKAGE_RELAY_LIST_KIND = 10051 as NDKKind;

function toFilterArray(filters: ApplesauceFilter): NDKFilter[] {
  return (Array.isArray(filters) ? filters : [filters]) as unknown as NDKFilter[];
}

function ndkEventToNostr(event: NDKEvent): ApplesauceEvent {
  return {
    id: event.id,
    kind: event.kind ?? 0,
    pubkey: event.pubkey,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at ?? 0,
    sig: event.sig ?? '',
  } as ApplesauceEvent;
}

function nostrEventToNdk(event: ApplesauceEvent, ndk: NDK): NDKEvent {
  const e = event as NDKNostrEvent;
  const ndkEvent = new NDKEvent(ndk, e);
  ndkEvent.id = e.id ?? '';
  ndkEvent.sig = e.sig;
  return ndkEvent;
}

export function createWhitenoiseNetwork(
  ndk: NDK,
  fallbackRelays: readonly string[]
): NostrNetworkInterface {
  function relaySet(urls: string[]): NDKRelaySet {
    const target = urls.length > 0 ? urls : [...fallbackRelays];
    return NDKRelaySet.fromRelayUrls(target, ndk);
  }

  return {
    async publish(relays, event) {
      const target = relays.length > 0 ? [...relays] : [...fallbackRelays];
      const ndkEvent = nostrEventToNdk(event, ndk);
      const set = NDKRelaySet.fromRelayUrls(target, ndk);
      // NDK normalizes relay URLs (lowercased, hash-stripped, trailing slash
      // forced) and stores them in `relay.url`. The marmot-supplied `target`
      // URLs typically aren't normalized, so a naive `acceptedUrls.has(url)`
      // membership check on the raw target reports every relay as "no ack"
      // even when they ack'd. Normalize both sides to a canonical key.
      const normalizedToOriginal = new Map<string, string>();
      for (const url of target) {
        try {
          normalizedToOriginal.set(normalizeRelayUrl(url), url);
        } catch {
          normalizedToOriginal.set(url, url);
        }
      }
      let accepted: Set<{ url: string }>;
      try {
        accepted = await ndkEvent.publish(set);
      } catch (err) {
        // NDK throws NDKPublishError when zero relays ack. Translate to the
        // marmot-shaped response so the caller sees a structured per-relay
        // failure rather than an opaque exception.
        const message = err instanceof Error ? err.message : 'publish failed';
        const failed: Record<string, PublishResponse> = {};
        for (const url of target) {
          failed[url] = { from: url, ok: false, message };
        }
        return failed;
      }
      const acceptedNormalized = new Set<string>();
      accepted.forEach((relay) => acceptedNormalized.add(relay.url));
      const result: Record<string, PublishResponse> = {};
      for (const [normalized, original] of normalizedToOriginal) {
        const ok = acceptedNormalized.has(normalized);
        result[original] = ok
          ? { from: original, ok: true }
          : { from: original, ok: false, message: 'no ack' };
      }
      return result;
    },

    async request(relays, filters) {
      const set = relaySet([...relays]);
      const filterArr = toFilterArray(filters);
      const events = await ndk.fetchEvents(filterArr, { closeOnEose: true }, set);
      const out: ApplesauceEvent[] = [];
      events.forEach((e: NDKEvent) => out.push(ndkEventToNostr(e)));
      return out;
    },

    subscription(relays, filters): Subscribable<ApplesauceEvent> {
      const set = relaySet([...relays]);
      const filterArr = toFilterArray(filters);
      return {
        subscribe(observer): Unsubscribable {
          let subRef: NDKSubscription | null = null;
          try {
            const sub = ndk.subscribe(filterArr, { closeOnEose: false }, set, false);
            subRef = sub;
            sub.on('event', (event: NDKEvent) => {
              try {
                observer.next?.(ndkEventToNostr(event));
              } catch (err) {
                observer.error?.(err);
              }
            });
            sub.on('eose', () => {
              // marmot consumes long-lived subs; keep streaming after EOSE.
            });
            sub.on('close', () => {
              observer.complete?.();
            });
            void sub.start();
          } catch (err) {
            observer.error?.(err);
          }
          return {
            unsubscribe() {
              subRef?.stop();
              subRef = null;
            },
          };
        },
      };
    },

    async getUserInboxRelays(pubkey) {
      const filter: NDKFilter = {
        kinds: [KEY_PACKAGE_RELAY_LIST_KIND],
        authors: [pubkey],
        limit: 1,
      };
      const event = await ndk.fetchEvent(filter);
      if (!event) return [...fallbackRelays];
      const urls = event.tags
        .filter((t: string[]) => t[0] === 'relay' && typeof t[1] === 'string')
        .map((t: string[]) => t[1]);
      return urls.length > 0 ? urls : [...fallbackRelays];
    },
  };
}

/**
 * `network.getUserInboxRelays` already falls back to the relay set when no
 * kind-10051 is published, but a network-level throw (relay timeout, NDK
 * lookup error) propagates. Both the inbox watcher and the DM-send path need
 * "best effort with fallback" — without this helper the DM send fails the
 * whole send on a transient relay blip while the inbox watcher silently uses
 * the fallback.
 */
export async function resolveInboxRelays(
  network: Pick<NostrNetworkInterface, 'getUserInboxRelays'>,
  pubkey: string,
  fallbackRelays: readonly string[]
): Promise<string[]> {
  try {
    const learned = await network.getUserInboxRelays(pubkey);
    return learned.length > 0 ? learned : [...fallbackRelays];
  } catch {
    return [...fallbackRelays];
  }
}
