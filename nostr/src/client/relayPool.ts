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
  /** First reconnect delay; doubles per consecutive failure. Default 3 s. */
  reconnectDelayMs?: number;
  /** Ceiling for the doubled delay. Default 60 s. */
  reconnectMaxDelayMs?: number;
  /** Source of the 0..1 reconnect jitter (tests pin it). Defaults to `Math.random`. */
  random?: () => number;
}

/** A socket that stayed open this long was a real connection: the next drop starts the backoff over. */
const STABLE_CONNECTION_MS = 30_000;

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
  frames: number;
  disconnectCount: number;
  /** Consecutive failed or short-lived connections; sets the reconnect delay. */
  backoffStep: number;
  /** When the current socket opened (ms), or null while it has not. */
  openedAt: number | null;
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
  private readonly configuredRelays = new Set<string>();
  private readonly activeQueryCancels = new Set<() => void>();
  private readonly listeners = new Map<NostrClientEvent, Set<(url: string) => void>>();
  private readonly wsImpl: (new (url: string) => WebSocketLike) | undefined;
  private readonly reconnectDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly random: () => number;
  private _paused = false;
  private _signer: NostrSigner | undefined;
  private _disposed = false;

  constructor(config: NostrClientConfig = {}) {
    this.wsImpl = config.WebSocketImpl;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 3_000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 60_000;
    this.random = config.random ?? Math.random;
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
      this.configuredRelays.add(url);
      if (!this.relays.has(url)) {
        const entry = this.createRelayEntry(url);
        this.relays.set(url, entry);
        added.push(url);
        // While paused, `resume` opens it; a publish or subscription still can.
        if (!this._paused) this.connectRelay(entry);
      } else {
        const entry = this.relays.get(url)!;
        if (!this._paused && !entry.socket && entry.status === 'disconnected') {
          this.connectRelay(entry);
        }
      }
    }
    return added;
  }

  get paused(): boolean {
    return this._paused;
  }

  /**
   * The app left the foreground. Stop reconnecting on a timer, and close every
   * socket that carries nothing: no subscription and no publish awaiting its
   * OK. A socket in use is left alone, and a publish or subscription started
   * while paused still connects, so nothing a caller asked for is dropped.
   */
  pause(): void {
    if (this._disposed || this._paused) return;
    this._paused = true;
    for (const relay of this.relays.values()) {
      if (relay.reconnectTimer) {
        clearTimeout(relay.reconnectTimer);
        relay.reconnectTimer = null;
      }
      if (!relay.socket || relay.pendingPublishes.size > 0 || relay.subscriptions.size > 0) continue;
      const sock = relay.socket;
      relay.socket = null;
      relay.openedAt = null;
      closeWebSocket(sock);
      this.setStatus(relay, 'disconnected');
    }
  }

  /** Back in the foreground: reconnect every configured relay now, from the first backoff step. */
  resume(): void {
    if (this._disposed || !this._paused) return;
    this._paused = false;
    for (const relay of this.relays.values()) {
      if (!this.configuredRelays.has(relay.url) || relay.socket) continue;
      if (relay.reconnectTimer) {
        clearTimeout(relay.reconnectTimer);
        relay.reconnectTimer = null;
      }
      relay.backoffStep = 0;
      this.connectRelay(relay);
    }
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

      const framesAtStart = relay.frames;
      const timer = setTimeout(() => {
        relay.pendingPublishes.delete(event.id);
        const timeoutErr = new Error(`Publish timed out after ${timeoutMs}ms on ${url}`);
        reject(timeoutErr);
        // Drop a stalled connecting socket or one that stayed completely silent
        // throughout this publish so the next retry opens a fresh connection.
        if (relay.socket && (relay.status !== 'connected' || relay.frames === framesAtStart)) {
          this.handleDisconnect(relay, timeoutErr);
        } else {
          this.maybeReleaseEphemeral(relay);
        }
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
        this.maybeReleaseEphemeral(relay);
      },
    };
  }

  queryRelay(
    rawUrl: string,
    filters: readonly Filter[],
    timeoutMs = 10_000,
    signal?: AbortSignal
  ): Promise<RelayQueryResult> {
    if (this._disposed || signal?.aborted) {
      return Promise.resolve({ events: [], eose: false });
    }
    return new Promise<RelayQueryResult>((resolve) => {
      const events: VerifiedEvent[] = [];
      let settled = false;
      let handle: RelaySubscriptionHandle | null = null;
      const cancel = () => finish(false);
      const finish = (eose: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.activeQueryCancels.delete(cancel);
        handle?.stop();
        resolve({ events, eose });
      };
      const onAbort = () => finish(false);
      this.activeQueryCancels.add(cancel);
      signal?.addEventListener('abort', onAbort, { once: true });
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

    for (const cancel of [...this.activeQueryCancels]) {
      cancel();
    }
    this.activeQueryCancels.clear();

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
    this.configuredRelays.clear();
    this.listeners.clear();
  }

  /** Drop one-off (non-configured) relays once their last publish/sub finishes. */
  private maybeReleaseEphemeral(relay: ManagedRelay): void {
    if (this.configuredRelays.has(relay.url)) return;
    if (relay.pendingPublishes.size > 0 || relay.subscriptions.size > 0) return;
    if (relay.reconnectTimer) {
      clearTimeout(relay.reconnectTimer);
      relay.reconnectTimer = null;
    }
    if (relay.socket) {
      const sock = relay.socket;
      relay.socket = null;
      closeWebSocket(sock);
    }
    relay.status = 'disconnected';
    this.relays.delete(relay.url);
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
      frames: 0,
      disconnectCount: 0,
      backoffStep: 0,
      openedAt: null,
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
      relay.openedAt = Date.now();
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
      relay.frames += 1;
      const parsed = parseWireFrame(msg.data);
      if (!parsed) return;
      const frame = parsed as unknown[];
      const type = frame[0];

      // NIP-01 requires a full 4-tuple: ["OK", <event_id>, <true|false>, <message>].
      // Ignore malformed/truncated frames so they never falsely confirm delivery.
      if (
        type === 'OK' &&
        frame.length >= 4 &&
        typeof frame[1] === 'string' &&
        typeof frame[2] === 'boolean' &&
        typeof frame[3] === 'string'
      ) {
        const eventId = frame[1];
        const accepted = frame[2];
        const reason = frame[3];
        const pending = relay.pendingPublishes.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          relay.pendingPublishes.delete(eventId);
          if (accepted) pending.resolve();
          else pending.reject(new Error(reason || `Relay rejected event ${eventId}`));
          this.maybeReleaseEphemeral(relay);
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
        this.maybeReleaseEphemeral(relay);
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
    // A relay that accepts and then drops straight away is as dead as one
    // that refuses: only a connection that lasted starts the backoff over.
    const lasted = relay.openedAt !== null && Date.now() - relay.openedAt >= STABLE_CONNECTION_MS;
    relay.openedAt = null;
    relay.backoffStep = lasted ? 1 : relay.backoffStep + 1;
    relay.disconnectCount += 1;
    this.setStatus(relay, relay.disconnectCount >= 2 ? 'flapping' : 'disconnected');
    this.failPending(relay, error);

    if (!this.configuredRelays.has(relay.url)) {
      this.maybeReleaseEphemeral(relay);
      return;
    }

    // Paused: `resume` reconnects. No timer runs while the app is in the background.
    if (this._paused) return;
    if (!this._disposed && this.relays.has(relay.url) && !relay.reconnectTimer) {
      relay.reconnectTimer = setTimeout(() => {
        relay.reconnectTimer = null;
        if (!this._disposed && !this._paused && this.relays.has(relay.url)) {
          this.connectRelay(relay);
        }
      }, this.reconnectDelay(relay.backoffStep));
    }
  }

  /** Exponential backoff with jitter: 3 s, 6 s, 12 s … capped at 60 s, each scaled by 0.5–1. */
  private reconnectDelay(step: number): number {
    const exponent = Math.min(Math.max(step - 1, 0), 20);
    const base = Math.min(this.reconnectDelayMs * 2 ** exponent, this.reconnectMaxDelayMs);
    return Math.round(base * (0.5 + this.random() / 2));
  }
}
