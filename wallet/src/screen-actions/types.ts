// ---------------------------------------------------------------------------
// Screen Actions — types
// ---------------------------------------------------------------------------

import type { FormattedString } from "../formatting/FormattedString";
import type { FormattedTimestamp } from "../formatting/FormattedTimestamp";
import type { ColadaSubscriptionBus } from "../subscriptions";
import type { PaymentRequestInfo } from "../types";

/**
 * Fields added by the built-in `decorateEntry()`. Screens combine this
 * with their base entry type for type-safe access:
 *
 *   type MyEntry = MeltHistoryEntry & DecoratedEntryFields;
 */
export interface DecoratedEntryFields {
  createdAt: FormattedTimestamp;
  tokenString: FormattedString | null;
  p2pkPubkey: FormattedString | null;
  npcAddress?: FormattedString;
  paymentRequestInfo: PaymentRequestInfo | null;
  transportLabel: string | null;
}

export type ScreenType =
  | "sendToken"
  | "receiveToken"
  | "mintQuote"
  | "meltQuote"
  | "paymentRequest"
  | "receiveHub"
  | "receive"
  | "mintInfo"
  | "amountEntry"
  | "mintSelector";

/**
 * Maps each screen type to the set of action names available on that screen.
 * Screens use this to get type-safe action names; the wallet implements handlers for each.
 */
export type ScreenActionName = {
  sendToken: "copy" | "share" | "nfc" | "checkStatus" | "cancel" | "back";
  receiveToken: "redeem" | "back";
  mintQuote: "copy" | "share" | "back";
  meltQuote: "pay" | "cancel" | "back";
  paymentRequest: "confirm" | "cancel" | "back";
  /** Receive modal root — the method chooser (QR Display / Scan QR / Fixed
   *  Amount / Paste). */
  receiveHub: "qrDisplay" | "scanQr" | "fixedAmount" | "paste" | "back";
  /** Receive QR display — the standing-rail tabs behind the hub's QR Display. */
  receive:
    | "copy"
    | "share"
    | "changeNpcMint"
    | "changeBolt12Mint"
    | "changeOnchainMint"
    | "back";
  mintInfo: "trust" | "copy" | "share" | "back";
  /** Flow amount screen — keyboard + submit; `setInput`/`toggle` are handled inside the manager. */
  amountEntry:
    | "setInput"
    | "toggle"
    | "next"
    | "paste"
    | "scanQr"
    | "cancel"
    | "back";
  /** Mint selector screen — select a mint, inspect details, or add new mints. */
  mintSelector: "select" | "getInfo" | "addMint" | "cancel" | "back";
};

/**
 * One alternate form of an action. Used to surface split-button menus in the UI
 * without forcing callers to invent sibling action names for every payment
 * method or format. Callers invoke a variant via
 * `actions.<name>.execute({ variantId: v.id })`; the `variantId` threads through
 * to the handler's ctx.
 *
 * Examples:
 *   - `sendToken.copy` → `[{ id: 'text', ... }, { id: 'emoji', ... }]`
 *   - `amountEntry.next` → `[{ id: 'ecash', ... }, { id: 'lightning', ... }]`
 */
export interface ActionVariant {
  /** Stable identifier — consumed by handlers via `ctx.variantId`. */
  id: string;
  /** Short label — e.g. "as Lightning", "as Emoji". */
  label: string;
  /** Optional description for UI; often the `reason` when `available === false`. */
  description?: string;
  /** iconify name, optional. UI renders as the item's leading glyph. */
  icon?: string;
  /** True when the variant can be executed; false variants still render disabled. */
  available: boolean;
  /** Human-readable explanation when `available === false`. */
  reason?: string;
  /** Marks destructive variants (red styling). */
  isDestructive?: boolean;
}

export interface ActionAvailability {
  available: boolean;
  reason?: string;
  /**
   * Machine-readable code for `reason` when it comes from a known cause. The UI
   * uses it to present *soft* reasons differently — notably a below-minimum
   * amount, which is a transient typing state (the user is on their way up to
   * the minimum) and should read as a neutral hint, not a red error.
   */
  reasonCode?: string;
  /**
   * Optional alternate forms of this action. When present, the UI can surface a
   * split-button menu and pass `{ variantId }` to `execute`.
   */
  variants?: ActionVariant[];
  /**
   * Amount-entry `next` only: true when the entered amount is larger than the
   * spendable balance. Reported independently of `available` because an ecash
   * send rounds the amount down to the balance and so stays available — only
   * lightning, which can't round down, would otherwise surface the shortfall.
   * Lets the UI flag an over-balance amount even when a rail can still fire.
   */
  exceedsBalance?: boolean;
}

export interface ActionState extends ActionAvailability {
  loading: boolean;
}

/**
 * Context passed to every action handler. The wallet populates this with
 * the current history entry and whatever platform services the handler needs.
 *
 * `manager` is typed as `unknown` so colada stays agnostic of
 * coco-cashu-core — the wallet casts it when constructing handlers.
 */
export interface ScreenActionContext<E = unknown> {
  entry: E;
  manager: unknown;
  [key: string]: unknown;
}

type MaybeAsync = void | Promise<void>;

export type ActionHandler<E = unknown> = (
  ctx: ScreenActionContext<E>,
) => MaybeAsync;

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
  execute: (
    action: ScreenActionName[S],
    params?: Record<string, unknown>,
  ) => Promise<void>;
  /** Current entry (updated via setEntry). */
  getEntry: () => Record<string, unknown> | null;
  /** Push a new entry (e.g. from history:updated). Recomputes availability. */
  setEntry: (entry: Record<string, unknown>) => void;
  /** Current state of all actions: available + loading. */
  inspect: () => Record<ScreenActionName[S], ActionState>;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// Screen Action Session — framework-agnostic page update interface
// ---------------------------------------------------------------------------

export interface ScreenActionsBridge {
  /** Merged into action context after core runtime context. */
  getExtraContext?: () => Record<string, unknown>;
  /**
   * Bind app-owned stores/native sources to Colada's subscription bus once
   * for the provider lifetime.
   */
  bindSubscriptionBus?: (bus: ColadaSubscriptionBus) => () => void;
  /**
   * Subscribe this screen to Colada bus events and map those events into
   * entry updates for the screen-action manager. Return unsubscribe.
   */
  subscribeEntryUpdates?: (
    screenType: ScreenType,
    callback: (entry: Record<string, unknown>) => void,
    bus: ColadaSubscriptionBus,
  ) => () => void;
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => boolean;
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>,
  ) => Record<string, unknown>;
  /** When omitted, Colada's built-in screen-action decoration is used. */
  decorateEntry?: (
    entry: Record<string, unknown> | null,
    ctx: { language: string },
  ) => Record<string, unknown> | null;
  getLocale?: () => string;
  /** Scan / NFC provenance label for the current entry. */
  getSourceLabel?: (entry: Record<string, unknown> | null) => string | null;
}
