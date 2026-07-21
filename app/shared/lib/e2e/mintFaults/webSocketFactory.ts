/**
 * NUT-17 WebSocket seam for mint-fault injection: a coco WebSocketFactory
 * that consults the fault engine per mint. 'down' sockets error+close so
 * coco's HybridTransport degrades to fast polling (through the faulted
 * fetch); 'silent' sockets open and swallow everything; 'pass'/no-rule mints
 * get a real socket, registry-tracked so a rule swap can force-close it and
 * push coco onto the faulted polling path. coco's WsTransport has reconnect
 * disabled, so a mint whose socket died stays on polling for the session even
 * after rules clear — polling is the honest fallback, so that residue is
 * acceptable. Only coco's factory argument is faked; the global WebSocket
 * (NDK relays) is never touched.
 */
import type { WebSocketFactory, WebSocketLike } from '@cashu/coco-core';
import { mintFaultEngine } from './engine';
import { isMintFaultInjectionEnabled } from './enabled';

type WsEventType = 'open' | 'message' | 'error' | 'close';

class FakeMintWebSocket implements WebSocketLike {
  private listeners = new Map<WsEventType, Set<(event: unknown) => void>>();
  private closed = false;

  constructor(private readonly mode: 'down' | 'silent') {
    setTimeout(() => {
      if (this.closed) return;
      if (this.mode === 'down') {
        this.emit('error', { message: 'e2e mint-fault: websocket down' });
        this.emitClose(4000, 'e2e mint-fault: websocket down');
      } else {
        this.emit('open', {});
      }
    }, 0);
  }

  send(): void {
    // 'silent' swallows every frame; 'down' is already closed.
  }

  close(code?: number, reason?: string): void {
    this.emitClose(code ?? 1000, reason ?? 'closed');
  }

  addEventListener(type: WsEventType, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: WsEventType, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: WsEventType, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        listener(event);
      } catch {
        // listener errors never propagate into the fake transport
      }
    }
  }

  private emitClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', { code, reason });
  }
}

const liveRealSockets = new Set<{ url: string; socket: WebSocketLike }>();

function closeSocketsInvalidatedByRuleSwap(): void {
  for (const entry of [...liveRealSockets]) {
    const mode = mintFaultEngine.wsModeFor(entry.url);
    if (mode !== null && mode !== 'pass') {
      liveRealSockets.delete(entry);
      try {
        entry.socket.close(4000, 'e2e mint-fault: rules changed');
      } catch {
        // best-effort teardown
      }
    }
  }
}

/**
 * Returns undefined unless mint-fault injection is enabled, preserving
 * today's Manager behavior (coco falls back to the global WebSocket) exactly.
 */
export function maybeCreateMintFaultWebSocketFactory(): WebSocketFactory | undefined {
  if (!isMintFaultInjectionEnabled()) return undefined;
  mintFaultEngine.addOnRulesSwapped(closeSocketsInvalidatedByRuleSwap);
  return (url: string): WebSocketLike => {
    const mode = mintFaultEngine.wsModeFor(url);
    if (mode === 'down' || mode === 'silent') return new FakeMintWebSocket(mode);
    const socket = new (globalThis as { WebSocket: new (url: string) => WebSocketLike }).WebSocket(
      url
    );
    const entry = { url, socket };
    liveRealSockets.add(entry);
    socket.addEventListener('close', () => liveRealSockets.delete(entry));
    return socket;
  };
}
