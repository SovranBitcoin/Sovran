import type { RawPrimalEvent } from './feedTypes';
import { normalizeRawPrimalEvent, parseJson } from './feedParse';

export const PRIMAL_CACHE_RELAY_URL = 'wss://cache2.primal.net/v1';
export const PRIMAL_KIND_NOTE_STATS = 10000100;
export const PRIMAL_KIND_MENTIONS = 10000107;
export const PRIMAL_KIND_FEED_RANGE = 10000113;

type RelayMessage =
  | ['EVENT', string, unknown]
  | ['EVENTS', string, unknown[]]
  | ['EOSE', string]
  | ['NOTICE', string]
  | ['OK', string, boolean, string];

export function createPrimalRelayClient(url: string) {
  const ws = new WebSocket(url);
  const OPEN_TIMEOUT_MS = 8000;
  const REQUEST_TIMEOUT_MS = 10000;
  const inflight = new Map<
    string,
    { events: RawPrimalEvent[]; resolve: (events: RawPrimalEvent[]) => void }
  >();
  let openSettled = false;

  const failAll = () => {
    inflight.forEach(({ resolve }) => resolve([]));
    inflight.clear();
  };

  ws.onmessage = (msg) => {
    if (typeof msg.data !== 'string') return;
    const parsed = parseJson<RelayMessage>(msg.data);
    if (!parsed || !Array.isArray(parsed)) return;

    if (parsed[0] === 'EVENT') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      const normalized = normalizeRawPrimalEvent(parsed[2]);
      if (normalized) active.events.push(normalized);
      return;
    }

    if (parsed[0] === 'EVENTS') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      for (const rawEvent of parsed[2]) {
        const normalized = normalizeRawPrimalEvent(rawEvent);
        if (normalized) active.events.push(normalized);
      }
      return;
    }

    if (parsed[0] === 'EOSE') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      active.resolve(active.events);
      inflight.delete(subId);
      return;
    }
  };

  let openTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const openPromise = new Promise<boolean>((resolve) => {
    const settle = (value: boolean) => {
      if (openSettled) return;
      openSettled = true;
      if (openTimeoutId !== undefined) clearTimeout(openTimeoutId);
      resolve(value);
    };

    ws.onopen = () => settle(true);
    ws.onerror = () => {
      failAll();
      settle(false);
    };
    ws.onclose = () => {
      failAll();
      settle(false);
    };

    if (ws.readyState === WebSocket.OPEN) {
      settle(true);
      return;
    }

    openTimeoutId = setTimeout(() => settle(false), OPEN_TIMEOUT_MS);
  });

  const request = async (subId: string, filter: Record<string, unknown>) => {
    const isOpen = await openPromise;
    if (!isOpen || ws.readyState !== WebSocket.OPEN) return [];

    return new Promise<RawPrimalEvent[]>((resolve) => {
      const requestState = { events: [] as RawPrimalEvent[], resolve };
      const timeoutId = setTimeout(() => {
        const active = inflight.get(subId);
        if (!active) return;
        inflight.delete(subId);
        resolve(active.events);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', subId]));
        }
      }, REQUEST_TIMEOUT_MS);

      inflight.set(subId, {
        events: requestState.events,
        resolve: (events) => {
          clearTimeout(timeoutId);
          resolve(events);
        },
      });
      ws.send(JSON.stringify(['REQ', subId, filter]));
    });
  };

  return {
    request,
    close: () => {
      ws.close();
    },
  };
}
