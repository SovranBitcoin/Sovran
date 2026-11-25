import { verifyEvent, type VerifiedEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import {
  closeWebSocket,
  openWebSocket,
  sendWebSocket,
  type WebSocketLike,
} from '../facade/websocket';
import { parseWireFrame } from '../facade/wire-frame';
import { normalizeRelayUrl, tryNormalizeRelayUrl } from './normalizeRelayUrl';
import type { NostrSigner, UnsignedNostrEvent } from './signer';

export type RelayHealth = 'connected' | 'connecting' | 'flapping' | 'disconnected';
export type NostrClientEvent = 'relay:connect' | 'relay:status';

export interface RelaySubscriptionHandlers {
  onEvent(event: VerifiedEvent): void;
  onEose(): void;
  onError?(error: Error): void;
}

export interface RelaySubscriptionHandle {
  stop(): void;
}

export interface RelayQueryResult {
  events: VerifiedEvent[];
  eose: boolean;
}

export interface NostrClientConfig {
  relays?: readonly string[];
  signer?: NostrSigner;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  reconnectDelayMs?: number;
}

interface PendingPublish {
  event: VerifiedEvent;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface ActiveSub {
  id: string;
  filters: readonly Filter[];
  sent: boolean;
  eoseSeen: boolean;
  handlers: RelaySubscriptionHandlers;
}

interface ManagedRelay {
  url: string;
  socket: WebSocketLike | null;
  status: RelayHealth;
  disconnectCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pendingPublishes: Map<string, PendingPublish>;
  subscriptions: Map<string, ActiveSub>;
}

let subCounter = 0;

function isVerifiedEvent(raw: unknown): raw is VerifiedEvent {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (
    typeof e.id !== 'string' ||
    typeof e.pubkey !== 'string' ||
    typeof e.sig !== 'string' ||
    typeof e.kind !== 'number' ||
    typeof e.created_at !== 'number' ||
    typeof e.content !== 'string' ||
    !Array.isArray(e.tags)
  ) {
    return false;
  }
  try {
    return verifyEvent(raw as VerifiedEvent);
  } catch {
    return false;
  }
}

/**
 * Pure `nostr-tools` + standard `WebSocket` Nostr client replacing NDK.
 *
 * Owns one persistent socket per relay URL, NIP-01 `EVENT`/`OK` publish acks,
 * per-relay `REQ`/`EOSE`/`CLOSE` subscriptions, relay health tracking, and
 * account-scoped signer lifecycle (`dispose()` closes every socket and zeroes
 * the signer's key copy).
 */
export class NostrClient {
  private readonly relays = new Map<string, ManagedRelay>();
  private readonly listeners = new Map<NostrClientEvent, Set<(url: string) => void>>();
  private readonly wsImpl: (new (url: string) => WebSocketLike) | undefined;
  private readonly reconnectDelayMs: number;
  private _signer: NostrSigner | undefined;
  private _disposed = false;

  constructor(config: NostrClientConfig = {}) {
    this.wsImpl = config.WebSocketImpl;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 3_000;
    this._signer = config.signer;
    if (config.relays && config.relays.length > 0) {
      this.ensureRelays(config.relays);
    }
  }

  get signer(): NostrSigner | undefined {
    return this._signer;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  setSigner(signer: NostrSigner | undefined): void {
    if (this._disposed) {
      signer?.dispose();
      return;
    }
    if (this._signer && this._signer !== signer) {
      this._signer.dispose();
    }
    this._signer = signer;
  }

  signEvent(template: UnsignedNostrEvent): VerifiedEvent {
    if (this._disposed || !this._signer) {
      throw new Error('Account signer is not ready');
    }
    return this._signer.sign(template);
  }

  relayUrls(): string[] {
    return [...this.relays.keys()];
  }

  getRelayHealth(): Record<string, RelayHealth> {
    const out: Record<string, RelayHealth> = {};
    for (const [url, relay] of this.relays) {
      out[url] = relay.status;
    }
    return out;
  }

  on(event: NostrClientEvent, listener: (url: string) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(event: NostrClientEvent, url: string): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(url);
      } catch {
        // Listener errors must never destabilize socket dispatch.
      }
    }
  }

  ensureRelays(urls: readonly string[]): string[] {
    if (this._disposed) return [];
    const added: string[] = [];
    for (const raw of urls) {
      const url = tryNormalizeRelayUrl(raw);
      if (!url) continue;
      if (!this.relays.has(url)) {
        const entry = this.createRelayEntry(url);
        this.relays.set(url, entry);
        added.push(url);
        this.connectRelay(entry);
      } else {
        const entry = this.relays.get(url)!;
        if (!entry.socket && entry.status === 'disconnected') {
          this.connectRelay(entry);
        }
      }
    }
    return added;
  }

  publishToRelay(rawUrl: string, event: VerifiedEvent, timeoutMs = 10_000): Promise<void> {
    if (this._disposed) {
      return Promise.reject(new Error('NostrClient disposed'));
    }
    let url: string;
    try {
      url = normalizeRelayUrl(rawUrl);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const relay = this.getOrCreateRelay(url);

    return new Promise<void>((resolve, reject) => {
      const existing = relay.pendingPublishes.get(event.id);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('Superseded by newer publish of same event'));
        relay.pendingPublishes.delete(event.id);
      }

      const timer = setTimeout(() => {
        relay.pendingPublishes.delete(event.id);
        reject(new Error(`Publish timed out after ${timeoutMs}ms on ${url}`));
      }, timeoutMs);

      const pending: PendingPublish = {
        event,
        sent: false,
        timer,
        resolve,
        reject,
      };
      relay.pendingPublishes.set(event.id, pending);

      if (relay.status === 'connected' && relay.socket) {
        this.flushPublish(relay, pending);
      } else {
        this.connectRelay(relay);
      }
    });
  }

  subscribeRelay(
    rawUrl: string,
    filters: readonly Filter[],
    handlers: RelaySubscriptionHandlers
  ): RelaySubscriptionHandle {
    if (this._disposed) {
      handlers.onError?.(new Error('NostrClient disposed'));
      return { stop: () => {} };
    }
    let url: string;
    try {
      url = normalizeRelayUrl(rawUrl);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      return { stop: () => {} };
    }

    const relay = this.getOrCreateRelay(url);
    const id = `s_${++subCounter}`;
    const sub: ActiveSub = {
      id,
      filters,
      sent: false,
      eoseSeen: false,
      handlers,
    };
    relay.subscriptions.set(id, sub);

    if (relay.status === 'connected' && relay.socket) {
      this.flushSub(relay, sub);
    } else {
      this.connectRelay(relay);
    }

    return {
      stop: () => {
        if (!relay.subscriptions.delete(id)) return;
        if (sub.sent && relay.status === 'connected' && relay.socket) {
          sendWebSocket(relay.socket, ['CLOSE', id]);
        }
      },
    };
  }

  queryRelay(rawUrl: string, filters: readonly Filter[], timeoutMs = 10_000): Promise<RelayQueryResult> {
    return new Promise<RelayQueryResult>((resolve) => {
      const events: VerifiedEvent[] = [];
      let settled = false;
      let handle: RelaySubscriptionHandle | null = null;
      const finish = (eose: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handle?.stop();
        resolve({ events, eose });
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      handle = this.subscribeRelay(rawUrl, filters, {
        onEvent: (event) => {
          events.push(event);
        },
        onEose: () => finish(true),
        onError: () => finish(false),
      });
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._signer?.dispose();
    this._signer = undefined;

    for (const relay of this.relays.values()) {
      if (relay.reconnectTimer) {
        clearTimeout(relay.reconnectTimer);
        relay.reconnectTimer = null;
      }
      for (const pending of relay.pendingPublishes.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('NostrClient disposed'));
      }
      relay.pendingPublishes.clear();
      relay.subscriptions.clear();
      if (relay.socket) {
        closeWebSocket(relay.socket);
        relay.socket = null;
      }
      relay.status = 'disconnected';
    }
    this.relays.clear();
    this.listeners.clear();
  }

  private getOrCreateRelay(url: string): ManagedRelay {
    let relay = this.relays.get(url);
    if (!relay) {
      relay = this.createRelayEntry(url);
      this.relays.set(url, relay);
    }
    return relay;
  }

  private createRelayEntry(url: string): ManagedRelay {
    return {
      url,
      socket: null,
      status: 'disconnected',
      disconnectCount: 0,
      reconnectTimer: null,
      pendingPublishes: new Map(),
      subscriptions: new Map(),
    };
  }

  private resolveWebSocketCtor(): (new (url: string) => WebSocketLike) | null {
    if (this.wsImpl) return this.wsImpl;
    const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    return typeof ctor === 'function' ? ctor : null;
  }

  private setStatus(relay: ManagedRelay, status: RelayHealth): void {
    if (relay.status === status) return;
    relay.status = status;
    this.emit('relay:status', relay.url);
  }

  private connectRelay(relay: ManagedRelay): void {
    if (this._disposed || relay.socket) return;
    const WebSocketCtor = this.resolveWebSocketCtor();
    if (!WebSocketCtor) {
      this.failPending(relay, new Error('WebSocket is unavailable'));
      return;
    }

    if (relay.reconnectTimer) {
      clearTimeout(relay.reconnectTimer);
      relay.reconnectTimer = null;
    }

    this.setStatus(relay, relay.disconnectCount >= 2 ? 'flapping' : 'connecting');
    const opened = openWebSocket(WebSocketCtor, relay.url);
    if (opened.isErr()) {
      this.handleDisconnect(relay, new Error(opened.error.message));
      return;
    }

    const socket = opened.value;
    relay.socket = socket;

    socket.onopen = () => {
      if (this._disposed || relay.socket !== socket) return;
      relay.disconnectCount = 0;
      this.setStatus(relay, 'connected');
      this.emit('relay:connect', relay.url);
      for (const pending of [...relay.pendingPublishes.values()]) {
        this.flushPublish(relay, pending);
      }
      for (const sub of [...relay.subscriptions.values()]) {
        this.flushSub(relay, sub);
      }
    };

    socket.onmessage = (msg) => {
      if (this._disposed || relay.socket !== socket) return;
      const parsed = parseWireFrame(msg.data);
      if (!parsed) return;
      const frame = parsed as unknown[];
      const type = frame[0];

      if (type === 'OK' && typeof frame[1] === 'string') {
        const eventId = frame[1];
        const accepted = frame[2] === true;
        const reason = typeof frame[3] === 'string' ? frame[3] : '';
        const pending = relay.pendingPublishes.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          relay.pendingPublishes.delete(eventId);
          if (accepted) pending.resolve();
          else pending.reject(new Error(reason || `Relay rejected event ${eventId}`));
        }
        return;
      }

      if (type === 'EVENT' && typeof frame[1] === 'string') {
        const sub = relay.subscriptions.get(frame[1]);
        if (!sub) return;
        if (isVerifiedEvent(frame[2])) {
          sub.handlers.onEvent(frame[2]);
        }
        return;
      }

      if (type === 'EOSE' && typeof frame[1] === 'string') {
        const sub = relay.subscriptions.get(frame[1]);
        if (!sub || sub.eoseSeen) return;
        sub.eoseSeen = true;
        sub.handlers.onEose();
        return;
      }

      if (type === 'CLOSED' && typeof frame[1] === 'string') {
        const sub = relay.subscriptions.get(frame[1]);
        if (!sub) return;
        relay.subscriptions.delete(frame[1]);
        const reason = typeof frame[2] === 'string' ? frame[2] : 'Subscription closed';
        sub.handlers.onError?.(new Error(reason));
      }
    };

    socket.onerror = () => {
      if (this._disposed || relay.socket !== socket) return;
      this.handleDisconnect(relay, new Error(`Relay socket error on ${relay.url}`));
    };

    socket.onclose = () => {
      if (this._disposed || relay.socket !== socket) return;
      this.handleDisconnect(relay, new Error(`Relay socket closed on ${relay.url}`));
    };
  }

  private flushPublish(relay: ManagedRelay, pending: PendingPublish): void {
    if (!relay.socket || pending.sent) return;
    pending.sent = true;
    const res = sendWebSocket(relay.socket, ['EVENT', pending.event]);
    if (res.isErr()) {
      clearTimeout(pending.timer);
      relay.pendingPublishes.delete(pending.event.id);
      pending.reject(new Error(res.error.message));
    }
  }

  private flushSub(relay: ManagedRelay, sub: ActiveSub): void {
    if (!relay.socket || sub.sent) return;
    sub.sent = true;
    const res = sendWebSocket(relay.socket, ['REQ', sub.id, ...sub.filters]);
    if (res.isErr()) {
      relay.subscriptions.delete(sub.id);
      sub.handlers.onError?.(new Error(res.error.message));
    }
  }

  private failPending(relay: ManagedRelay, error: Error): void {
    for (const pending of [...relay.pendingPublishes.values()]) {
      clearTimeout(pending.timer);
      relay.pendingPublishes.delete(pending.event.id);
      pending.reject(error);
    }
    for (const sub of [...relay.subscriptions.values()]) {
      relay.subscriptions.delete(sub.id);
      sub.handlers.onError?.(error);
    }
  }

  private handleDisconnect(relay: ManagedRelay, error: Error): void {
    if (relay.socket) {
      const sock = relay.socket;
      relay.socket = null;
      closeWebSocket(sock);
    }
    relay.disconnectCount += 1;
    this.setStatus(relay, relay.disconnectCount >= 2 ? 'flapping' : 'disconnected');
    this.failPending(relay, error);

    if (!this._disposed && this.relays.has(relay.url) && !relay.reconnectTimer) {
      relay.reconnectTimer = setTimeout(() => {
        relay.reconnectTimer = null;
        if (!this._disposed && this.relays.has(relay.url)) {
          this.connectRelay(relay);
        }
      }, this.reconnectDelayMs);
    }
  }
}
