// ---------------------------------------------------------------------------
// Screen Actions — types
// ---------------------------------------------------------------------------

export type ScreenType =
  | 'sendToken'
  | 'receiveToken'
  | 'mintQuote'
  | 'meltQuote'
  | 'paymentRequest';

/**
 * Maps each screen type to the set of action names available on that screen.
 * Screens use this to get type-safe action names; the wallet implements handlers for each.
 */
export type ScreenActionName = {
  sendToken: 'copy' | 'share' | 'nfc' | 'copyAsEmoji' | 'checkStatus' | 'cancel';
  receiveToken: 'redeem';
  mintQuote: 'copy' | 'share';
  meltQuote: 'pay' | 'cancel';
  paymentRequest: 'confirm' | 'cancel';
};

export interface ActionAvailability {
  available: boolean;
  reason?: string;
}

export interface ActionState extends ActionAvailability {
  loading: boolean;
}

/**
 * Context passed to every action handler. The wallet populates this with
 * the current history entry and whatever platform services the handler needs.
 *
 * `manager` is typed as `unknown` so coco-payment-ux stays agnostic of
 * coco-cashu-core — the wallet casts it when constructing handlers.
 */
export interface ScreenActionContext<E = unknown> {
  entry: E;
  manager: unknown;
  [key: string]: unknown;
}

type MaybeAsync = void | Promise<void>;

export type ActionHandler<E = unknown> = (ctx: ScreenActionContext<E>) => MaybeAsync;

/**
 * Wallet provides one handler per action per screen.
 * Same pattern as `StepHandlerMap` for the flow machine.
 */
export type ScreenActionHandlerMap = {
  [S in ScreenType]?: {
    [A in ScreenActionName[S]]?: ActionHandler;
  };
};

// ---------------------------------------------------------------------------
// Screen Action Manager — runtime interface
// ---------------------------------------------------------------------------

export interface ScreenActionManager<S extends ScreenType> {
  /** Execute a named action. Sets loading, calls the handler, clears loading. */
  execute: (action: ScreenActionName[S]) => Promise<void>;
  /** Current entry (updated via setEntry). */
  getEntry: () => Record<string, unknown> | null;
  /** Push a new entry (e.g. from history:updated). Recomputes availability. */
  setEntry: (entry: Record<string, unknown>) => void;
  /** Current state of all actions: available + loading. */
  inspect: () => Record<ScreenActionName[S], ActionState>;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}
