/**
 * Test doubles for the account's `NostrClient` (`nostr/client`).
 *
 * `fakeClient` is the client surface the app's Nostr code uses, with each
 * relay behaviour supplied by the suite. `fakeSigner` signs synchronously into
 * events whose ids are a counter. `pureTrustingFakeEvents` is a
 * `nostr-tools/pure` for `jest.mock` whose hash and signature checks accept
 * those events: an event's id is its hash unless it carries a different
 * `hash`, and its signature verifies unless it is `'invalid'`.
 */
import type {
  NostrClient,
  RelayHealth,
  RelaySubscriptionHandle,
  RelaySubscriptionHandlers,
  UnsignedNostrEvent,
} from 'nostr/client';
import type { Filter } from 'nostr-tools/filter';
import type { VerifiedEvent } from 'nostr-tools/pure';

let signedSeq = 0;

/** Fields a fake relay sends as a verified event (the client's own verification is the fake's). */
export function asVerified(fields: object): VerifiedEvent {
  const event: unknown = fields;
  return event as VerifiedEvent;
}

/** What the fake signer returns for `template`, signed by `pubkey`. */
export function fakeSigned(template: UnsignedNostrEvent, pubkey: string): VerifiedEvent {
  return asVerified({
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    pubkey,
    id: (++signedSeq).toString(16).padStart(64, '0'),
    sig: 'sig',
  });
}

export type FakeSigner = {
  pubkey: string;
  sign: jest.Mock<VerifiedEvent, [UnsignedNostrEvent]>;
  encrypt: jest.Mock;
  decrypt: jest.Mock;
  dispose: jest.Mock;
};

export function fakeSigner(pubkey: string): FakeSigner {
  const signer: FakeSigner = {
    pubkey,
    sign: jest.fn((template: UnsignedNostrEvent) => fakeSigned(template, signer.pubkey)),
    encrypt: jest.fn((_peer: string, plaintext: string) => plaintext),
    decrypt: jest.fn((_peer: string, ciphertext: string) => ciphertext),
    dispose: jest.fn(),
  };
  return signer;
}

export function pureTrustingFakeEvents() {
  const actual = jest.requireActual<typeof import('nostr-tools/pure')>('nostr-tools/pure');
  return {
    ...actual,
    getEventHash: (event: { id: string; hash?: string }) => event.hash ?? event.id,
    verifyEvent: (event: { sig: string }) => event.sig !== 'invalid',
  };
}

function emptyHealth(): Record<string, RelayHealth> {
  return {};
}

export type FakeClient = NostrClient & {
  signer: unknown;
  /** A pool relay (re)connects. */
  connect(url: string): void;
  /** Every relay status listener is told `url` changed. */
  statusChanged(url: string): void;
  health: Record<string, RelayHealth>;
};

export function fakeClient(
  options: {
    signer?: unknown;
    relays?: string[];
    subscribeRelay?: (
      url: string,
      filters: readonly Filter[],
      handlers: RelaySubscriptionHandlers
    ) => RelaySubscriptionHandle;
    publishToRelay?: (url: string, event: VerifiedEvent) => Promise<void>;
    queryRelay?: (
      url: string,
      filters: readonly Filter[]
    ) => Promise<{ events: VerifiedEvent[]; eose: boolean }>;
  } = {}
): FakeClient {
  const listeners = {
    'relay:connect': new Set<(url: string) => void>(),
    'relay:status': new Set<(url: string) => void>(),
  };
  const pool = options.relays ?? [];
  const client = {
    signer: options.signer,
    disposed: false,
    health: emptyHealth(),
    relayUrls: () => [...pool],
    ensureRelays: (urls: readonly string[]) => {
      const added = urls.filter((url) => !pool.includes(url));
      pool.push(...added);
      return added;
    },
    getRelayHealth: () => ({ ...client.health }),
    signEvent: (template: UnsignedNostrEvent) => {
      const signer = client.signer as
        { sign?: (t: UnsignedNostrEvent) => VerifiedEvent } | undefined;
      if (!signer?.sign) throw new Error('Account signer is not ready');
      return signer.sign(template);
    },
    on: (event: keyof typeof listeners, listener: (url: string) => void) => {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    connect: (url: string) => {
      for (const listener of [...listeners['relay:connect']]) listener(url);
    },
    statusChanged: (url: string) => {
      for (const listener of [...listeners['relay:status']]) listener(url);
    },
    subscribeRelay:
      options.subscribeRelay ??
      ((_url: string, _filters: readonly Filter[], _handlers: RelaySubscriptionHandlers) => ({
        stop: () => undefined,
      })),
    publishToRelay: options.publishToRelay ?? (async () => undefined),
    queryRelay: options.queryRelay ?? (async () => ({ events: [], eose: true })),
    dispose: () => {
      client.disposed = true;
    },
  };
  return client as unknown as FakeClient;
}
