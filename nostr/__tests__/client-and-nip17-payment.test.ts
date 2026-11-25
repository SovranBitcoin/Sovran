import { describe, expect, it } from 'vitest';
import * as nip44 from 'nostr-tools/nip44';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  verifyEvent,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import type { WebSocketLike } from '../src/facade/websocket';
import {
  NostrClient,
  createPrivateKeySigner,
  normalizeRelayUrl,
  tryNormalizeRelayUrl,
} from '../src/client';

class InMemoryRelayBus {
  readonly stored: VerifiedEvent[] = [];
  rejectNextReason: string | null = null;
  silentNextPublish = false;
  injectForgedOnQuery = false;

  createSocketClass(): new (url: string) => WebSocketLike {
    const bus = this;
    return class FakeRelaySocket implements WebSocketLike {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      closed = false;

      constructor(public readonly url: string) {
        queueMicrotask(() => {
          if (!this.closed) this.onopen?.();
        });
      }

      send(raw: string): void {
        if (this.closed) throw new Error('socket closed');
        const frame = JSON.parse(raw) as unknown[];
        const type = frame[0];

        if (type === 'EVENT') {
          const event = frame[1] as VerifiedEvent;
          if (bus.silentNextPublish) {
            bus.silentNextPublish = false;
            return;
          }
          if (bus.rejectNextReason) {
            const reason = bus.rejectNextReason;
            bus.rejectNextReason = null;
            queueMicrotask(() => {
              this.onmessage?.({ data: JSON.stringify(['OK', event.id, false, reason]) });
            });
            return;
          }
          bus.stored.push(event);
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) });
          });
          return;
        }

        if (type === 'REQ') {
          const subId = frame[1] as string;
          const filter = (frame[2] ?? {}) as {
            kinds?: number[];
            authors?: string[];
            '#p'?: string[];
          };
          queueMicrotask(() => {
            if (this.closed) return;
            if (bus.injectForgedOnQuery) {
              const forged = {
                id: '0'.repeat(64),
                pubkey: '1'.repeat(64),
                created_at: 1_700_000_000,
                kind: 1059,
                tags: [],
                content: 'forged',
                sig: '2'.repeat(128),
              };
              this.onmessage?.({ data: JSON.stringify(['EVENT', subId, forged]) });
            }
            for (const event of bus.stored) {
              if (filter.kinds && !filter.kinds.includes(event.kind)) continue;
              if (filter.authors && !filter.authors.includes(event.pubkey)) continue;
              if (
                filter['#p'] &&
                !event.tags.some((t) => t[0] === 'p' && filter['#p']!.includes(t[1] ?? ''))
              ) {
                continue;
              }
              this.onmessage?.({ data: JSON.stringify(['EVENT', subId, event]) });
            }
            this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
          });
        }
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
      }
    };
  }
}

function nip17Wrap(params: {
  senderSk: Uint8Array;
  recipientPubkey: string;
  wrapTargetPubkey: string;
  content: string;
}): VerifiedEvent {
  const senderPubkey = getPublicKey(params.senderSk);
  const now = Math.floor(Date.now() / 1000);
  const rumorUnsigned = {
    kind: 14,
    pubkey: senderPubkey,
    created_at: now,
    tags: [['p', params.recipientPubkey]],
    content: params.content,
  };
  const rumor = { ...rumorUnsigned, id: getEventHash(rumorUnsigned) };

  const sealKey = nip44.v2.utils.getConversationKey(params.senderSk, params.wrapTargetPubkey);
  const seal = finalizeEvent(
    {
      kind: 13,
      created_at: now,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify(rumor), sealKey),
    },
    params.senderSk
  );

  const ephemeralSk = generateSecretKey();
  const wrapKey = nip44.v2.utils.getConversationKey(ephemeralSk, params.wrapTargetPubkey);
  return finalizeEvent(
    {
      kind: 1059,
      created_at: now,
      tags: [['p', params.wrapTargetPubkey]],
      content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey),
    },
    ephemeralSk
  );
}

function nip17Unwrap(recipientSk: Uint8Array, wrap: VerifiedEvent): {
  senderPubkey: string;
  content: string;
} {
  const wrapKey = nip44.v2.utils.getConversationKey(recipientSk, wrap.pubkey);
  const seal = JSON.parse(nip44.v2.decrypt(wrap.content, wrapKey)) as VerifiedEvent;
  expect(verifyEvent(seal)).toBe(true);
  const sealKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
  const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealKey)) as {
    pubkey: string;
    content: string;
  };
  expect(rumor.pubkey).toBe(seal.pubkey);
  return { senderPubkey: rumor.pubkey, content: rumor.content };
}

describe('nostr client & pure nostr-tools NIP-17 payment transport', () => {
  it('normalizes valid ws/wss relay URLs, preserves path/query distinction, and rejects invalid schemes', () => {
    expect(normalizeRelayUrl('WSS://Relay.Damus.IO')).toBe('wss://relay.damus.io/');
    expect(normalizeRelayUrl('wss://nos.lol:443/')).toBe('wss://nos.lol/');
    // Saved relay lists kept NDK's trailing slash on queryless paths.
    expect(normalizeRelayUrl('wss://nostr.wine/inbox/')).toBe('wss://nostr.wine/inbox/');
    expect(normalizeRelayUrl('wss://a.example/path')).toBe('wss://a.example/path/');
    // Distinct path/query endpoints must never collapse into each other.
    expect(normalizeRelayUrl('wss://relay.example/a/?x=1')).toBe('wss://relay.example/a/?x=1');
    expect(normalizeRelayUrl('wss://relay.example/a?x=1')).toBe('wss://relay.example/a?x=1');
    expect(tryNormalizeRelayUrl('https://not-a-relay.example')).toBeNull();
    expect(tryNormalizeRelayUrl('javascript:alert(1)')).toBeNull();
    expect(tryNormalizeRelayUrl('http-not-relay')).toBeNull();
  });

  it('ignores truncated NIP-01 OK frames and drops stalled connecting sockets on timeout', async () => {
    let constructions = 0;
    let sendTruncatedOk = true;
    class FlakySocket implements WebSocketLike {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;
      closed = false;

      constructor(public readonly url: string) {
        constructions += 1;
        if (sendTruncatedOk) {
          queueMicrotask(() => {
            if (!this.closed) this.onopen?.();
          });
        }
      }

      send(raw: string): void {
        const frame = JSON.parse(raw) as unknown[];
        if (frame[0] === 'EVENT' && sendTruncatedOk) {
          const ev = frame[1] as VerifiedEvent;
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', ev.id, true]) });
          });
        }
      }

      close(): void {
        this.closed = true;
      }
    }

    const sk = generateSecretKey();
    const client = new NostrClient({
      signer: createPrivateKeySigner(sk),
      WebSocketImpl: FlakySocket,
      reconnectDelayMs: 60_000,
    });
    const ev = client.signEvent({ kind: 1, tags: [], content: 'strict-ok' });

    await expect(client.publishToRelay('wss://flaky.test/', ev, 40)).rejects.toThrow('timed out');

    sendTruncatedOk = false;
    const before = constructions;
    await expect(client.publishToRelay('wss://stalled.test/', ev, 30)).rejects.toThrow('timed out');
    await expect(client.publishToRelay('wss://stalled.test/', ev, 30)).rejects.toThrow('timed out');
    expect(constructions - before).toBe(2);

    client.dispose();
  });

  it('signs valid events and zeroes key copy on signer dispose', () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(sk);
    const event = signer.sign({ kind: 1, tags: [], content: 'hello' });
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(signer.pubkey);

    signer.dispose();
    expect(() => signer.sign({ kind: 1, tags: [], content: 'after dispose' })).toThrow(
      'disposed'
    );
  });

  it('proves NIP-17 ecash payment send + receive round-trip on pure nostr-tools without NDK', async () => {
    const bus = new InMemoryRelayBus();
    const Ws = bus.createSocketClass();
    const relayUrl = 'wss://relay.test.local/';

    const senderSk = generateSecretKey();
    const senderPubkey = getPublicKey(senderSk);
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);

    const senderClient = new NostrClient({
      relays: [relayUrl],
      signer: createPrivateKeySigner(senderSk),
      WebSocketImpl: Ws,
    });
    const recipientClient = new NostrClient({
      relays: [relayUrl],
      signer: createPrivateKeySigner(recipientSk),
      WebSocketImpl: Ws,
    });

    const cashuToken = 'cashuBo2F0gaJhaUgA1234567890abcdef_ecash_payment_token';
    const recipientWrap = nip17Wrap({
      senderSk,
      recipientPubkey,
      wrapTargetPubkey: recipientPubkey,
      content: cashuToken,
    });
    const senderWrap = nip17Wrap({
      senderSk,
      recipientPubkey,
      wrapTargetPubkey: senderPubkey,
      content: cashuToken,
    });

    await senderClient.publishToRelay(relayUrl, recipientWrap, 2_000);
    await senderClient.publishToRelay(relayUrl, senderWrap, 2_000);

    // Inject a forged kind-1059 event to prove the client drops invalid signatures.
    bus.injectForgedOnQuery = true;
    const received = await recipientClient.queryRelay(
      relayUrl,
      [{ kinds: [1059], '#p': [recipientPubkey] }],
      2_000
    );

    expect(received.eose).toBe(true);
    expect(received.events).toHaveLength(1);
    const unwrapped = nip17Unwrap(recipientSk, received.events[0]!);
    expect(unwrapped.senderPubkey).toBe(senderPubkey);
    expect(unwrapped.content).toBe(cashuToken);

    // Sender self-copy also resolves cleanly.
    bus.injectForgedOnQuery = false;
    const selfCopy = await senderClient.queryRelay(
      relayUrl,
      [{ kinds: [1059], '#p': [senderPubkey] }],
      2_000
    );
    expect(selfCopy.events).toHaveLength(1);
    expect(nip17Unwrap(senderSk, selfCopy.events[0]!).content).toBe(cashuToken);

    // Relay rejection and publish timeout fail loudly.
    const ping = senderClient.signEvent({ kind: 1, tags: [], content: 'ping' });
    bus.rejectNextReason = 'blocked: spam';
    await expect(senderClient.publishToRelay(relayUrl, ping, 2_000)).rejects.toThrow(
      'blocked: spam'
    );

    bus.silentNextPublish = true;
    await expect(senderClient.publishToRelay(relayUrl, ping, 50)).rejects.toThrow('timed out');

    senderClient.dispose();
    recipientClient.dispose();
    expect(senderClient.signer).toBeUndefined();
    expect(senderClient.relayUrls()).toEqual([]);
  });

  it('closes the underlying relay subscription immediately when queryRelay signal aborts', async () => {
    const frames: unknown[][] = [];
    class SilentSubSocket implements WebSocketLike {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onclose: ((e: unknown) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }

      send(raw: string): void {
        frames.push(JSON.parse(raw) as unknown[]);
      }

      close(): void {
        this.readyState = 3;
      }
    }

    const client = new NostrClient({ WebSocketImpl: SilentSubSocket });
    const controller = new AbortController();
    const pending = client.queryRelay('wss://silent.test/', [{ kinds: [37375] }], 10_000, controller.signal);
    await new Promise((r) => setTimeout(r, 10));
    expect(frames.some((f) => f[0] === 'REQ')).toBe(true);
    const reqId = frames.find((f) => f[0] === 'REQ')?.[1];

    controller.abort();
    const result = await pending;
    expect(result).toEqual({ events: [], eose: false });
    expect(frames).toContainEqual(['CLOSE', reqId]);

    client.dispose();
  });
});
