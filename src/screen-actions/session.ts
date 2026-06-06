import type {
  CreateAmountActionManagerConfig,
  QuickSendSuggestion,
} from '../amount-actions';
import type { ColadaSubscriptionBus } from '../subscriptions';
import {
  createScreenActionManager,
  decorateEntry as defaultDecorateEntry,
  mergeEntryUpdate as defaultMergeEntryUpdate,
  shouldApplyEntryUpdate as defaultShouldApplyEntryUpdate,
} from './createManager';
import type {
  ActionState,
  ScreenActionHandlerMap,
  ScreenActionName,
  ScreenActionsBridge,
  ScreenActionManager,
  ScreenType,
} from './types';

export type ScreenActionEntrySeed =
  | Record<string, unknown>
  | string
  | undefined;

export type ScreenActionEntryUpdateSubscriber = (
  callback: (entry: Record<string, unknown>) => void,
) => () => void;

export interface ScreenActionSessionSnapshot<S extends ScreenType> {
  entry: Record<string, unknown> | null;
  error: string | null;
  actions: Record<ScreenActionName[S], ActionState>;
  mintUrl: string | undefined;
  source: S extends 'amountEntry' ? null : string | null;
  suggestions: QuickSendSuggestion[];
}

export interface ScreenActionSession<S extends ScreenType> {
  inspect: () => ScreenActionSessionSnapshot<S>;
  subscribe: (listener: () => void) => () => void;
  execute: (
    action: ScreenActionName[S],
    params?: Record<string, unknown>,
  ) => Promise<void>;
  setEntry: (entry: Record<string, unknown>) => void;
  setEntrySeed: (entrySeed: ScreenActionEntrySeed) => void;
  dispose: () => void;
}

export interface CreateScreenActionSessionConfig<S extends ScreenType> {
  screenType: S;
  handlers: ScreenActionHandlerMap[S];
  defaultHandlers?: ScreenActionHandlerMap[S];
  entrySeed: ScreenActionEntrySeed;
  getExtraContext?: () => Record<string, unknown>;
  subscribeEntryUpdates?: ScreenActionEntryUpdateSubscriber;
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => boolean;
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => Record<string, unknown>;
  amountConfig?: CreateAmountActionManagerConfig;
  subscriptionBus?: ColadaSubscriptionBus;
  bridge?: ScreenActionsBridge;
  getLocale?: () => string;
  decorateEntry?: ScreenActionsBridge['decorateEntry'];
}

function parseEntrySeed(
  screenType: ScreenType,
  seed: ScreenActionEntrySeed,
): {
  parsed: Record<string, unknown> | null;
  error: string | null;
} {
  if (screenType === 'amountEntry') {
    if (seed == null) return { parsed: {}, error: null };
    if (typeof seed === 'string') {
      if (!seed.trim()) return { parsed: {}, error: null };
      try {
        return {
          parsed: JSON.parse(seed) as Record<string, unknown>,
          error: null,
        };
      } catch {
        return { parsed: null, error: 'Invalid amount screen data.' };
      }
    }
    return { parsed: seed, error: null };
  }

  if (!seed) {
    return {
      parsed: null,
      error: 'Missing transaction data. Please try again.',
    };
  }
  if (typeof seed === 'string') {
    try {
      return {
        parsed: JSON.parse(seed) as Record<string, unknown>,
        error: null,
      };
    } catch {
      return {
        parsed: null,
        error: 'Invalid transaction data. Please try again.',
      };
    }
  }
  return { parsed: seed, error: null };
}

function getMintUrl(entry: Record<string, unknown> | null): string | undefined {
  if (!entry) return undefined;
  const url = entry.mintUrl ?? entry.selectedMintUrl;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

function getSuggestions(
  entry: Record<string, unknown> | null,
): QuickSendSuggestion[] {
  return Array.isArray(entry?.suggestions)
    ? (entry.suggestions as QuickSendSuggestion[])
    : [];
}

export function createScreenActionSession<S extends ScreenType>(
  config: CreateScreenActionSessionConfig<S>,
): ScreenActionSession<S> {
  const {
    screenType,
    handlers,
    defaultHandlers,
    getExtraContext,
    subscribeEntryUpdates,
    shouldApplyEntryUpdate,
    mergeEntryUpdate,
    amountConfig,
    subscriptionBus,
    bridge,
    getLocale,
    decorateEntry,
  } = config;

  let parseError: string | null = null;
  let snapshot: ScreenActionSessionSnapshot<S> | null = null;
  let disposed = false;
  let entryUpdateUnsubscribe: (() => void) | null = null;

  const listeners = new Set<() => void>();

  let manager = null as unknown as ScreenActionManager<S>;

  manager = createScreenActionManager<S>({
    screenType,
    handlers,
    defaultHandlers,
    getContext: () => ({
      entry: manager.getEntry() ?? {},
      manager: null,
      setEntry: (entry: Record<string, unknown>) => manager.setEntry(entry),
      ...getExtraContext?.(),
      ...bridge?.getExtraContext?.(),
    }),
    amountConfig: screenType === 'amountEntry' ? amountConfig : undefined,
  });

  function notify(): void {
    if (disposed) return;
    snapshot = null;
    for (const listener of listeners) {
      listener();
    }
  }

  const unsubscribeManager = manager.subscribe(notify);
  const unsubscribeScreenActionsChanged = subscriptionBus?.subscribe(
    { type: 'screenActions.changed' },
    notify,
  );

  function subscribeToEntryUpdates(): void {
    if (entryUpdateUnsubscribe || screenType === 'amountEntry') return;

    const subscriber =
      subscribeEntryUpdates ??
      (bridge?.subscribeEntryUpdates && subscriptionBus
        ? (callback: (entry: Record<string, unknown>) => void) =>
            bridge.subscribeEntryUpdates!(screenType, callback, subscriptionBus)
        : undefined);

    if (!subscriber) return;

    entryUpdateUnsubscribe = subscriber((updated) => {
      const currentEntry = manager.getEntry();
      const shouldApply =
        shouldApplyEntryUpdate ??
        bridge?.shouldApplyEntryUpdate ??
        defaultShouldApplyEntryUpdate;
      if (!shouldApply(currentEntry, updated)) return;

      const merge =
        mergeEntryUpdate ?? bridge?.mergeEntryUpdate ?? defaultMergeEntryUpdate;
      manager.setEntry(merge(currentEntry, updated));
    });
  }

  function setEntrySeed(entrySeed: ScreenActionEntrySeed): void {
    const { parsed, error } = parseEntrySeed(screenType, entrySeed);
    parseError = error;
    if (parsed != null) {
      manager.setEntry(parsed);
      subscribeToEntryUpdates();
      return;
    }
    notify();
  }

  function inspect(): ScreenActionSessionSnapshot<S> {
    if (snapshot) return snapshot;

    const rawEntry = manager.getEntry();
    const skipDecoration =
      screenType === 'amountEntry' || screenType === 'mintSelector';
    const language = bridge?.getLocale?.() ?? getLocale?.() ?? 'en';
    const decorate = bridge?.decorateEntry ?? decorateEntry;
    const decoratedEntry = skipDecoration
      ? rawEntry
      : decorate
        ? decorate(rawEntry, { language })
        : defaultDecorateEntry(rawEntry, language);
    const source = skipDecoration
      ? null
      : (bridge?.getSourceLabel?.(rawEntry) ?? null);

    snapshot = {
      entry: decoratedEntry,
      error: parseError,
      actions: manager.inspect(),
      mintUrl: getMintUrl(rawEntry),
      source: source as ScreenActionSessionSnapshot<S>['source'],
      suggestions: getSuggestions(rawEntry),
    };
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  setEntrySeed(config.entrySeed);

  return {
    inspect,
    subscribe,
    execute: manager.execute,
    setEntry: manager.setEntry,
    setEntrySeed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      entryUpdateUnsubscribe?.();
      unsubscribeManager();
      unsubscribeScreenActionsChanged?.();
    },
  };
}
