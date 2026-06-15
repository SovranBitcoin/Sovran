import type {
  CreateAmountActionManagerConfig,
  QuickSendSuggestion,
} from '../amount-actions';
import { errField, logger } from '../logger';
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

function summarizeEntry(
  entry: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    hasEntry: !!entry,
    id: typeof entry?.id === 'string' ? entry.id : null,
    type: typeof entry?.type === 'string' ? entry.type : null,
    state: typeof entry?.state === 'string' ? entry.state : null,
    mintUrl: typeof entry?.mintUrl === 'string' ? entry.mintUrl : null,
    keyCount: entry ? Object.keys(entry).length : 0,
  };
}

function summarizeEntrySeed(
  entrySeed: ScreenActionEntrySeed,
): Record<string, unknown> {
  return {
    seedType:
      typeof entrySeed === 'string'
        ? 'string'
        : entrySeed == null
          ? 'empty'
          : 'object',
    seedLength: typeof entrySeed === 'string' ? entrySeed.length : 0,
    keyCount:
      entrySeed && typeof entrySeed === 'object'
        ? Object.keys(entrySeed).length
        : 0,
  };
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

  logger.info('screenActionSession.create', {
    screenType,
    hasDefaultHandlers: !!defaultHandlers,
    hasExtraContextGetter: !!getExtraContext,
    hasSubscribeEntryUpdates: !!subscribeEntryUpdates,
    hasAmountConfig: !!amountConfig,
    hasSubscriptionBus: !!subscriptionBus,
    hasBridge: !!bridge,
    hasLocaleGetter: !!getLocale,
    hasDecorateEntry: !!decorateEntry,
    ...summarizeEntrySeed(config.entrySeed),
  });

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
    logger.debug('screenActionSession.notify', {
      screenType,
      listenerCount: listeners.size,
    });
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
    if (entryUpdateUnsubscribe || screenType === 'amountEntry') {
      logger.debug('screenActionSession.entryUpdates.skipped', {
        screenType,
        reason: entryUpdateUnsubscribe ? 'already_subscribed' : 'amount_entry',
      });
      return;
    }

    const subscriber =
      subscribeEntryUpdates ??
      (bridge?.subscribeEntryUpdates && subscriptionBus
        ? (callback: (entry: Record<string, unknown>) => void) =>
            bridge.subscribeEntryUpdates!(screenType, callback, subscriptionBus)
        : undefined);

    if (!subscriber) {
      logger.debug('screenActionSession.entryUpdates.skipped', {
        screenType,
        reason: 'no_subscriber',
      });
      return;
    }

    logger.info('screenActionSession.entryUpdates.subscribe', { screenType });
    entryUpdateUnsubscribe = subscriber((updated) => {
      const currentEntry = manager.getEntry();
      const shouldApply =
        shouldApplyEntryUpdate ??
        bridge?.shouldApplyEntryUpdate ??
        defaultShouldApplyEntryUpdate;
      if (!shouldApply(currentEntry, updated)) {
        logger.debug('screenActionSession.entryUpdates.skipped', {
          screenType,
          reason: 'should_apply_false',
          current: summarizeEntry(currentEntry),
          updated: summarizeEntry(updated),
        });
        return;
      }

      const merge =
        mergeEntryUpdate ?? bridge?.mergeEntryUpdate ?? defaultMergeEntryUpdate;
      logger.info('screenActionSession.entryUpdates.apply', {
        screenType,
        current: summarizeEntry(currentEntry),
        updated: summarizeEntry(updated),
      });
      manager.setEntry(merge(currentEntry, updated));
    });
  }

  function setEntrySeed(entrySeed: ScreenActionEntrySeed): void {
    const { parsed, error } = parseEntrySeed(screenType, entrySeed);
    parseError = error;
    logger.info('screenActionSession.setEntrySeed', {
      screenType,
      ...summarizeEntrySeed(entrySeed),
      parsed: summarizeEntry(parsed),
      error,
    });
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
    logger.debug('screenActionSession.inspect', {
      screenType,
      raw: summarizeEntry(rawEntry),
      decorated: summarizeEntry(decoratedEntry),
      error: parseError,
      actionCount: Object.keys(snapshot.actions).length,
      availableActionCount: (
        Object.values(snapshot.actions) as ActionState[]
      ).filter((action) => action.available).length,
      suggestionCount: snapshot.suggestions.length,
      hasSource: !!snapshot.source,
      skipDecoration,
    });
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    logger.debug('screenActionSession.subscribe', {
      screenType,
      listenerCount: listeners.size,
    });
    return () => {
      listeners.delete(listener);
      logger.debug('screenActionSession.unsubscribe', {
        screenType,
        listenerCount: listeners.size,
      });
    };
  }

  setEntrySeed(config.entrySeed);

  return {
    inspect,
    subscribe,
    execute: async (action, params) => {
      logger.info('screenActionSession.execute.start', {
        screenType,
        action,
        paramKeys: Object.keys(params ?? {}),
        entry: summarizeEntry(manager.getEntry()),
      });
      try {
        await manager.execute(action, params);
        logger.info('screenActionSession.execute.done', {
          screenType,
          action,
          entry: summarizeEntry(manager.getEntry()),
        });
      } catch (error) {
        logger.warn('screenActionSession.execute.failed', {
          screenType,
          action,
          error: errField(error),
        });
        throw error;
      }
    },
    setEntry: (entry) => {
      logger.info('screenActionSession.setEntry', {
        screenType,
        entry: summarizeEntry(entry),
      });
      manager.setEntry(entry);
    },
    setEntrySeed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      logger.info('screenActionSession.dispose', {
        screenType,
        listenerCount: listeners.size,
        hadEntryUpdateSubscription: !!entryUpdateUnsubscribe,
      });
      listeners.clear();
      entryUpdateUnsubscribe?.();
      unsubscribeManager();
      unsubscribeScreenActionsChanged?.();
    },
  };
}
