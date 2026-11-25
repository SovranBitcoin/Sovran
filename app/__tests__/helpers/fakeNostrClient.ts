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
import {
  tryNormalizeRelayUrl,
  type NostrClient,
  type NostrSigner,
  type RelayHealth,
  type RelaySubscriptionHandle,
  type RelaySubscriptionHandlers,
  type UnsignedNostrEvent,
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
      filters: readonly Filter[],
      timeoutMs?: number,
      signal?: AbortSignal
    ) => Promise<{ events: VerifiedEvent[]; eose: boolean }>;
  } = {}
): FakeClient {
  const listeners = {
    'relay:connect': new Set<(url: string) => void>(),
    'relay:status': new Set<(url: string) => void>(),
  };
  const pool = [...(options.relays ?? [])];
  const client = {
    signer: options.signer,
    disposed: false,
    health: emptyHealth(),
    setSigner: (next: NostrSigner | undefined) => {
      if (client.disposed) {
        next?.dispose();
        return;
      }
      const prev = client.signer as { dispose?: () => void } | undefined;
      if (prev && prev !== next) prev.dispose?.();
      client.signer = next;
    },
    relayUrls: () => [...pool],
    ensureRelays: (urls: readonly string[]) => {
      if (client.disposed) return [];
      const added: string[] = [];
      for (const raw of urls) {
        const normalized = tryNormalizeRelayUrl(raw) ?? raw;
        if (!pool.includes(normalized)) {
          pool.push(normalized);
          added.push(normalized);
        }
      }
      return added;
    },
    getRelayHealth: () => ({ ...client.health }),
    signEvent: (template: UnsignedNostrEvent) => {
      if (client.disposed) throw new Error('Account signer is not ready');
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
    subscribeRelay: (
      url: string,
      filters: readonly Filter[],
      handlers: RelaySubscriptionHandlers
    ) => {
      if (client.disposed) {
        handlers.onError?.(new Error('NostrClient disposed'));
        return { stop: () => undefined };
      }
      return options.subscribeRelay
        ? options.subscribeRelay(url, filters, handlers)
        : { stop: () => undefined };
    },
    publishToRelay: async (url: string, event: VerifiedEvent) => {
      if (client.disposed) throw new Error('NostrClient disposed');
      if (options.publishToRelay) await options.publishToRelay(url, event);
    },
    queryRelay: async (
      url: string,
      filters: readonly Filter[],
      timeoutMs?: number,
      signal?: AbortSignal
    ) => {
      if (client.disposed || signal?.aborted) return { events: [], eose: false };
      return options.queryRelay
        ? options.queryRelay(url, filters, timeoutMs, signal)
        : { events: [], eose: true };
    },
    dispose: () => {
      if (client.disposed) return;
      client.disposed = true;
      const prev = client.signer as { dispose?: () => void } | undefined;
      prev?.dispose?.();
      client.signer = undefined;
    },
  };
  return client as unknown as FakeClient;
}
