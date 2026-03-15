// ---------------------------------------------------------------------------
// Screen Actions — stateful runtime (mirrors createPaymentMachine pattern)
// ---------------------------------------------------------------------------

import { getAvailableActions } from './availability';
import type {
  ActionState,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from './types';

interface CreateScreenActionManagerConfig<S extends ScreenType> {
  screenType: S;
  handlers: ScreenActionHandlerMap[S];
  getContext: () => ScreenActionContext;
}

export function createScreenActionManager<S extends ScreenType>(
  config: CreateScreenActionManagerConfig<S>
): ScreenActionManager<S> {
  const { screenType, handlers, getContext } = config;

  let entry: Record<string, unknown> | null = null;
  const loadingActions = new Set<string>();
  const listeners = new Set<() => void>();

  let cachedState: Record<ScreenActionName[S], ActionState> | null = null;

  function notify(): void {
    cachedState = null;
    for (const listener of listeners) {
      listener();
    }
  }

  function buildState(): Record<ScreenActionName[S], ActionState> {
    if (!entry) {
      const empty = {} as Record<ScreenActionName[S], ActionState>;
      const defaultState: ActionState = { available: false, loading: false };
      const names = getActionNames(screenType);
      for (const name of names) {
        empty[name as ScreenActionName[S]] = defaultState;
      }
      return empty;
    }

    const availability = getAvailableActions(screenType, entry);
    const result = {} as Record<ScreenActionName[S], ActionState>;

    for (const [name, avail] of Object.entries(availability) as [
      ScreenActionName[S],
      { available: boolean; reason?: string },
    ][]) {
      result[name] = {
        ...avail,
        loading: loadingActions.has(name as string),
      };
    }

    return result;
  }

  const execute = async (action: ScreenActionName[S]): Promise<void> => {
    const handlerMap = handlers as
      | Record<string, ((ctx: ScreenActionContext) => void | Promise<void>) | undefined>
      | undefined;
    const handler = handlerMap?.[action as string];
    if (!handler) return;

    loadingActions.add(action as string);
    notify();

    try {
      const ctx = getContext();
      if (entry) {
        ctx.entry = entry;
      }
      await handler(ctx);
    } finally {
      loadingActions.delete(action as string);
      notify();
    }
  };

  const getEntry = (): Record<string, unknown> | null => entry;

  const setEntry = (newEntry: Record<string, unknown>): void => {
    entry = newEntry;
    notify();
  };

  const inspect = (): Record<ScreenActionName[S], ActionState> => {
    if (!cachedState) {
      cachedState = buildState();
    }
    return cachedState;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { execute, getEntry, setEntry, inspect, subscribe };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_NAMES: Record<ScreenType, string[]> = {
  sendToken: ['copy', 'share', 'nfc', 'copyAsEmoji', 'checkStatus', 'cancel'],
  receiveToken: ['redeem'],
  mintQuote: ['copy', 'share'],
  meltQuote: ['pay', 'cancel'],
};

function getActionNames(screenType: ScreenType): string[] {
  return ACTION_NAMES[screenType];
}
