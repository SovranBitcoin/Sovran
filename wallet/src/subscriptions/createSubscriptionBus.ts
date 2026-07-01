import type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
  SubscriptionFilter,
  SubscriptionListener,
} from "./types";
import { logger } from "../logger";

type FilteredListener = {
  filter: SubscriptionFilter;
  listener: SubscriptionListener;
};

const FILTER_KEYS = [
  "historyType",
  "entryId",
  "quoteId",
  "operationId",
  "mintUrl",
] as const;

function summarizeFilter(filter: SubscriptionFilter): Record<string, unknown> {
  return {
    type: filter.type,
    historyType: filter.historyType,
    hasEntryId: !!filter.entryId,
    hasQuoteId: !!filter.quoteId,
    hasOperationId: !!filter.operationId,
    mintUrl: filter.mintUrl,
  };
}

function summarizeEvent(
  event: ColadaSubscriptionEvent,
): Record<string, unknown> {
  const record = event as unknown as Record<string, unknown>;
  return {
    type: event.type,
    historyType: record.historyType,
    hasEntryId: typeof record.entryId === "string",
    hasQuoteId: typeof record.quoteId === "string",
    hasOperationId: typeof record.operationId === "string",
    mintUrl: typeof record.mintUrl === "string" ? record.mintUrl : undefined,
  };
}

function eventMatchesType(
  filter: SubscriptionFilter,
  event: ColadaSubscriptionEvent,
): boolean {
  if (!filter.type) return true;
  if (Array.isArray(filter.type)) {
    return filter.type.includes(event.type);
  }
  return filter.type === event.type;
}

function eventMatchesField(
  event: ColadaSubscriptionEvent,
  key: (typeof FILTER_KEYS)[number],
  value: string | undefined,
): boolean {
  if (value === undefined) return true;
  return (event as unknown as Record<string, unknown>)[key] === value;
}

export function matchesSubscriptionFilter(
  filter: SubscriptionFilter,
  event: ColadaSubscriptionEvent,
): boolean {
  if (!eventMatchesType(filter, event)) return false;
  for (const key of FILTER_KEYS) {
    if (!eventMatchesField(event, key, filter[key])) return false;
  }
  return true;
}

export function createSubscriptionBus(): ColadaSubscriptionBus {
  const filteredListeners = new Set<FilteredListener>();
  const allListeners = new Set<SubscriptionListener>();

  return {
    subscribe: (filter, listener) => {
      const entry: FilteredListener = {
        filter: { ...filter },
        listener: listener as SubscriptionListener,
      };
      filteredListeners.add(entry);
      logger.debug("subscriptions.subscribe", {
        ...summarizeFilter(filter),
        filteredListenerCount: filteredListeners.size,
        allListenerCount: allListeners.size,
      });
      return () => {
        filteredListeners.delete(entry);
        logger.debug("subscriptions.unsubscribe", {
          ...summarizeFilter(filter),
          filteredListenerCount: filteredListeners.size,
          allListenerCount: allListeners.size,
        });
      };
    },
    subscribeAll: (listener) => {
      allListeners.add(listener);
      logger.debug("subscriptions.subscribeAll", {
        filteredListenerCount: filteredListeners.size,
        allListenerCount: allListeners.size,
      });
      return () => {
        allListeners.delete(listener);
        logger.debug("subscriptions.unsubscribeAll", {
          filteredListenerCount: filteredListeners.size,
          allListenerCount: allListeners.size,
        });
      };
    },
    publish: (event) => {
      let filteredDelivered = 0;
      logger.debug("subscriptions.publish.start", {
        ...summarizeEvent(event),
        filteredListenerCount: filteredListeners.size,
        allListenerCount: allListeners.size,
      });
      for (const listener of allListeners) {
        listener(event);
      }
      for (const { filter, listener } of filteredListeners) {
        if (matchesSubscriptionFilter(filter, event)) {
          filteredDelivered += 1;
          listener(event);
        }
      }
      logger.info("subscriptions.publish.done", {
        ...summarizeEvent(event),
        allDelivered: allListeners.size,
        filteredDelivered,
      });
    },
  };
}
