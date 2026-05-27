import type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
  SubscriptionFilter,
  SubscriptionListener,
} from './types';

type FilteredListener = {
  filter: SubscriptionFilter;
  listener: SubscriptionListener;
};

const FILTER_KEYS = ['historyType', 'entryId', 'quoteId', 'operationId', 'mintUrl'] as const;

function eventMatchesType(filter: SubscriptionFilter, event: ColadaSubscriptionEvent): boolean {
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
      return () => {
        filteredListeners.delete(entry);
      };
    },
    subscribeAll: (listener) => {
      allListeners.add(listener);
      return () => {
        allListeners.delete(listener);
      };
    },
    publish: (event) => {
      for (const listener of allListeners) {
        listener(event);
      }
      for (const { filter, listener } of filteredListeners) {
        if (matchesSubscriptionFilter(filter, event)) {
          listener(event);
        }
      }
    },
  };
}
