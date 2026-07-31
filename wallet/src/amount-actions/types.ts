// ---------------------------------------------------------------------------
// Amount Actions — types
//
// Action system for the amount input screen. The manager owns ALL input state
// including the raw keyboard string, so the UI component is stateless.
// Follows the same subscribe/inspect pattern as ScreenActionManager.
// ---------------------------------------------------------------------------

import type { AmountEntryEnvelope } from '../mint-capabilities';

/** Integer amount in a unit's minor denomination (sat, usd-cents, …). */
export interface UnitAmount {
  value: number;
  unit: string;
}

/**
 * - 'unit': typing in the active account unit — integer sats on the sat
 *   account, 2-decimal major-denomination entry producing integer minor
 *   units (cents) on fiat accounts.
 * - 'fiat': display-currency entry converted to sats. Only reachable when
 *   the active unit is 'sat' (the swapper toggle); fiat accounts input in
 *   their own unit and never convert.
 */
export type AmountInputMode = 'unit' | 'fiat';

/**
 * Core resolution fields — the pure math output from resolveAmount().
 * Does not include display formatting; the manager adds those.
 */
export interface CoreAmountResolution {
  /** Current input mode. */
  inputMode: AmountInputMode;
  /** Raw string as entered via the keyboard (e.g. "0.02", "42", ""). */
  rawInput: string;
  /** Parsed numeric value in current mode's major denomination. */
  numericValue: number;
  /** Resolved amount to submit to the machine, in minor units of its unit. */
  effectiveAmount: UnitAmount;
  /** Whether the effective amount can be sent offline. null when N/A. */
  canSendOffline: boolean | null;
  /** Display-currency equivalent. null off the sat account or without price. */
  displayFiat: number | null;
  /** Minor-unit equivalent of the entry (sats on sat account, cents on fiat). */
  displayAmount: number;
  /**
   * True when fiat mode auto-selected an offline-compatible sat amount
   * within the fiat rounding window (different from the naive center).
   */
  autoOptimized: boolean;
}

/**
 * Full resolved amount state — core math plus display fields.
 * This is what inspect() returns and what the UI renders from.
 */
export interface AmountResolution extends CoreAmountResolution {
  /** Active account unit. Always effectiveAmount.unit. */
  unit: string;
  /** Unit the keyboard should use — the unit code, or the display-currency code in 'fiat' mode. */
  keyboardUnit: string;
  /** Secondary display text (e.g. '≈ $0.02' or '≈ 42 sats'). null off the sat account. */
  secondaryDisplay: string | null;
  /** Display-currency code (e.g. 'usd'). null when the swapper toggle is unavailable. */
  fiatCurrency: string | null;
  /** Display-currency symbol (e.g. '$'). null when the swapper toggle is unavailable. */
  fiatSymbol: string | null;
  /** Symbol of the account unit itself — '$'/'€'/'£' on fiat accounts, '' on sat. */
  unitSymbol: string;
  /** Current BTC price in the configured display currency. 0 when unavailable. */
  btcPrice: number;
  /** Quick send suggestions — offline-composable amounts for one-tap entry. Empty when N/A. */
  suggestions: QuickSendSuggestion[];
  /** True when the last setInput was replaced by the envelope cap. */
  clampedToCap: boolean;
  /** The envelope max the keypad is capped at. null when uncapped. */
  inputCap: UnitAmount | null;
}

/**
 * A single quick send suggestion — an offline-composable amount
 * ready for one-tap entry. Carries display label and the input values
 * needed to apply it (mode + raw input string).
 */
export interface QuickSendSuggestion {
  /** Display label: "$5" or "1,000 sats" */
  label: string;
  /** Raw input value to set on tap */
  inputValue: string;
  /** Input mode to switch to on tap */
  inputMode: AmountInputMode;
  /** Exact minor-unit amount this resolves to (offline-composable) */
  amount: UnitAmount;
  /** When true, this suggestion represents the full wallet balance. */
  sendAll?: boolean;
}

/**
 * Configuration for creating an AmountActionManager.
 *
 * Reactive fields (`offlineOptimization`, `unit`, `fiatCurrency`, `fiatSymbol`)
 * accept either a constant or a getter function. The manager re-reads getters
 * on every `inspect()`, so callers that change destination/unit/display
 * currency mid-flow can pass a getter and avoid rebuilding the manager (which
 * would reset input state). Constants stay supported for the simple case
 * where these values genuinely don't change for the manager's lifetime.
 */
export interface CreateAmountActionManagerConfig {
  /** Returns the currently selected mint URL. */
  getMintUrl: () => string | undefined;
  /** Returns proof amounts for the selected mint, in the active unit's minor units. */
  getProofAmounts: () => number[];
  /** Returns current BTC price in user's fiat currency. */
  getBtcPrice: () => number;
  /**
   * Whether offline proof analysis and fiat-window optimization apply.
   * Set to true for ecash sends, false for receive/melt flows. Pass a getter
   * to track destination changes mid-flow without rebuilding the manager.
   */
  offlineOptimization: boolean | (() => boolean);
  /**
   * Whether quick-send suggestions are computed. Defaults to the
   * `offlineOptimization` gate when omitted. Set independently when the two
   * scopes differ — suggestions cover every ecash send path (direct send AND
   * paying a payment request), while offline optimization stays direct-send
   * only. Pass a getter to track destination changes mid-flow.
   */
  suggestionsEnabled?: boolean | (() => boolean);
  /** Active account unit (e.g. 'sat', 'usd'). Pass a getter when the unit can change. */
  unit: string | (() => string);
  /**
   * Display-currency code (e.g. 'usd'). Enables the swapper toggle on the sat
   * account when both fiatCurrency and fiatSymbol resolve truthy. Pass a
   * getter to track display-currency changes mid-flow.
   */
  fiatCurrency?: string | (() => string | undefined);
  /** Display-currency symbol (e.g. '$'). Enables the swapper toggle alongside fiatCurrency. */
  fiatSymbol?: string | (() => string | undefined);
  /** Quick send suggestion config. Omit for defaults, null to disable. */
  quickSendConfig?: QuickSendConfig | null;
  /**
   * Typed-input envelope for the current flow (per active unit/destination).
   * Re-read on every setInput; `maxAmount` hard-caps typing by replacement.
   * Omit or return null for uncapped input.
   */
  getAmountEnvelope?: () => AmountEntryEnvelope | null;
}

/**
 * Configuration for quick send suggestion targets and limits.
 */
export interface QuickSendConfig {
  /** Display-currency amounts to try on the sat account (default: $0.10–$100 range) */
  fiatTargets?: number[];
  /** Sat amounts to try (default: broad range from 21 to 100,000) */
  satTargets?: number[];
  /** Max suggestions to pick per category (default: 3) */
  limit?: number;
}

/**
 * Stateful manager for amount screen actions.
 * Owns the raw keyboard string and input mode. Computes offline sendability
 * and auto-optimizes fiat amounts for offline compatibility.
 *
 * Follows the same subscribe/inspect pattern as ScreenActionManager
 * and PaymentMachine for use with useSyncExternalStore.
 */
export interface AmountActionManager {
  /** Set the raw input string (forwarded from CustomKeyboard's onKeyPress). */
  setInput: (rawInput: string) => void;
  /** Set input mode directly (used by suggestion taps). No-op when the toggle is unavailable. */
  setMode: (mode: AmountInputMode) => void;
  /** Toggle between unit and display-currency input. No-op off the sat account. */
  toggle: () => void;
  /** Get current resolved state. Stable reference when result unchanged. */
  inspect: () => AmountResolution;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}
