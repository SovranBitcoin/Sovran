/**
 * The runner as another person (ADR 0033): someone with a Nostr key made for
 * this one play, whom the person in the story pays and who pays them back by
 * message. The key is new each time, holds nothing and is never used again.
 *
 * This is the one place a story reaches public relays: an encrypted gift wrap
 * (NIP-17) between two keys nobody else has, which is how the app itself hands
 * ecash to a person. The owner allowed it for these stories on 2026-10-13.
 */
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  type NostrEvent,
} from 'nostr-tools';
import { createRumor, createSeal, unwrapEvent } from 'nostr-tools/nip59';
import { SimplePool } from 'nostr-tools/pool';

/**
 * Relays the app both publishes a message to and reads its own from, and that
 * stop serving a message once it has expired.
 */
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const GIFT_WRAP = 1059;
const DIRECT_MESSAGE = 14;
/**
 * How long a message the other person sends stays on the relays. A wallet put
 * back to a saved moment reads its messages again, and its mint has been put
 * back too: ecash left there would be taken in a second time.
 */
const MESSAGE_LASTS_S = 60;

interface Person {
  /** What the story types to pay them: `{{person}}`. */
  npub: string;
  /** What reached them from whoever paid: who it was, and what they sent. */
  received(withinMs: number): Promise<{ from: string; content: string }>;
  /** Send a message, such as a token, to someone's public key. */
  send(to: string, content: string): Promise<void>;
  leave(): void;
}

/**
 * A message for one person that only they can open, and that relays stop
 * serving `MESSAGE_LASTS_S` after `now`. Wrapped by hand, as nostr-tools'
 * `createWrap` does, so that the wrap can say when it expires.
 */
export function messageFor(
  secret: Uint8Array,
  to: string,
  content: string,
  now: number
): NostrEvent {
  const rumor = createRumor({ kind: DIRECT_MESSAGE, content, tags: [['p', to]] }, secret);
  const seal = createSeal(rumor, secret, to);
  const oneTimeKey = generateSecretKey();
  return finalizeEvent(
    {
      kind: GIFT_WRAP,
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(oneTimeKey, to)),
      created_at: now,
      tags: [
        ['p', to],
        ['expiration', String(now + MESSAGE_LASTS_S)],
      ],
    },
    oneTimeKey
  );
}

export function makePerson(): Person {
  const secret = generateSecretKey();
  const publicKey = getPublicKey(secret);
  const pool = new SimplePool();
  return {
    npub: nip19.npubEncode(publicKey),
    async received(withinMs) {
      const deadline = performance.now() + withinMs;
      while (performance.now() < deadline) {
        const wraps: NostrEvent[] = await pool
          .querySync(RELAYS, { kinds: [GIFT_WRAP], '#p': [publicKey] }, { maxWait: 3000 })
          .catch(() => []);
        for (const wrap of wraps) {
          try {
            const message = unwrapEvent(wrap, secret);
            return { from: message.pubkey, content: message.content };
          } catch {
            // Not something this key can open: someone else's noise on the relay.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('Nothing reached the other person on the relays in time.');
    },
    async send(to, content) {
      const wrap = messageFor(secret, to, content, Math.floor(Date.now() / 1000));
      // One relay taking it is enough: the app reads from all of them.
      await Promise.any(pool.publish(RELAYS, wrap));
    },
    leave() {
      pool.close(RELAYS);
    },
  };
}
