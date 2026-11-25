/**
 * @fileoverview Liveness probes for the Nostr data layer's three tiers.
 *
 * nagg exposes an HTTP `/healthz` (JSON `{ ok: "true", … }`). Primal's cache has
 * no health endpoint, so we treat a WebSocket round-trip — a minimal Nostr REQ
 * answered by any frame before a timeout — as "online". Raw relay liveness comes
 * from the NDK pool via `useRelayHealth`; `foldRelayStatus` collapses that
 * per-URL map into one tier status.
 *
 * These are pure functions (no React, no module globals) so the screen hook
 * stays thin and they unit-test without a harness. The success channel is a
 * `boolean` (the probe ran and produced a verdict); `err` means the probe itself
 * could not run (network/abort/socket failure) and is treated as offline.
 */
import { ResultAsync } from 'neverthrow';

import { type RedactedError } from '@/shared/lib/logger';
import type { RelayHealth } from '@/shared/hooks/useRelayHealth';

/** Uniform per-tier status the Network screen renders. `disabled` = toggle off. */
export type TierStatus = 'online' | 'offline' | 'checking' | 'disabled';

/**
 * One Fast-cache server's status. With Fast cache off no server is used, so
 * every one is off whatever its last probe said; an unprobed one is checking.
 */
export function primalHostStatus({
  tierEnabled,
  hostEnabled,
  health,
}: {
  tierEnabled: boolean;
  hostEnabled: boolean;
  health: TierStatus | undefined;
}): TierStatus {
  return tierEnabled && hostEnabled ? (health ?? 'checking') : 'disabled';
}

const PRIMAL_HEALTH_TIMEOUT_MS = 5_000;

/**
 * Probe Primal's cache. It has no `/healthz`, so we open the WebSocket, send a
 * minimal Nostr REQ, and treat the first response frame as "online". The socket
 * is always closed (CLOSE + `close()`) before resolving, and a timer caps the
 * wait so a dead host resolves offline rather than hanging.
 */
export function probePrimalHealth(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal; WebSocketImpl?: typeof WebSocket } = {}
): ResultAsync<boolean, RedactedError> {
  const timeoutMs = options.timeoutMs ?? PRIMAL_HEALTH_TIMEOUT_MS;
  const WebSocketCtor = options.WebSocketImpl ?? WebSocket;
  return ResultAsync.fromSafePromise(
    new Promise<boolean>((resolve) => {
      const subId = 'health';
      let settled = false;
      let ws: WebSocket | null = null;
      const finish = (online: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Close in its own try so a throwing `send` (socket not OPEN) can't skip it.
        try {
          if (ws && ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(['CLOSE', subId]));
        } catch {
          // Socket changed state mid-call; close() below still runs.
        }
        try {
          ws?.close();
        } catch {
          // Already closing/closed — nothing left to clean up.
        }
        resolve(online);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        ws = new WebSocketCtor(url);
      } catch {
        finish(false);
        return;
      }
      ws.onopen = () => {
        try {
          ws?.send(JSON.stringify(['REQ', subId, { kinds: [1], limit: 1 }]));
        } catch {
          finish(false);
        }
      };
      ws.onmessage = () => finish(true);
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
      if (options.signal?.aborted) finish(false);
      else options.signal?.addEventListener('abort', () => finish(false), { once: true });
    })
  );
}

/**
 * Collapse the per-relay NDK-pool health map into one tier status: online if any
 * relay is connected, checking if any is connecting (and none connected), else
 * offline (including an empty pool).
 */
export function foldRelayStatus(map: Record<string, RelayHealth>): TierStatus {
  const values = Object.values(map);
  if (values.some((s) => s === 'connected')) return 'online';
  if (values.some((s) => s === 'connecting')) return 'checking';
  return 'offline';
}
