// ---------------------------------------------------------------------------
// Amount Actions — types
//
// Action system for the amount input screen. The manager owns ALL input state
// including the raw keyboard string, so the UI component is stateless.
// Follows the same subscribe/inspect pattern as ScreenActionManager.
// ---------------------------------------------------------------------------

export type AmountInputMode = 'sat' | 'fiat';

/**
 * Core resolution fields — the pure math output from resolveAmount().
 * Does not include display formatting; the manager adds those.
 */
export interface CoreAmountResolution {
  /** Current input mode. */
  inputMode: AmountInputMode;
  /** Raw string as entered via the keyboard (e.g. "0.02", "42", ""). */
  rawInput: string;
  /** Parsed numeric value in current mode units (sats or fiat). */
  numericValue: number;
  /** Resolved satoshi amount to submit to the machine. */
  effectiveSatAmount: number;
  /** Whether the effective amount can be sent offline. null when N/A. */
  canSendOffline: boolean | null;
  /** Fiat equivalent for display. null when btcPrice unavailable. */
  displayFiat: number | null;
  /** Satoshi equivalent for display. */
  displaySats: number;
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
  /** Base unit (e.g. 'sat'). Always the configured unit regardless of mode. */
  unit: string;
  /** Unit the keyboard should use — 'sat' in sat mode, fiat currency code in fiat mode. */
  keyboardUnit: string;
  /** Secondary display text (e.g. '≈ $0.02' or '≈ 42 sats'). null when fiat toggle unavailable. */
  secondaryDisplay: string | null;
  /** Fiat currency code (e.g. 'usd'). null when fiat toggle unavailable. */
  fiatCurrency: string | null;
  /** Fiat currency symbol (e.g. '$'). null when fiat toggle unavailable. */
  fiatSymbol: string | null;
  /** Current BTC price in the configured fiat. 0 when unavailable. */
  btcPrice: number;
  /** Quick send suggestions — offline-composable amounts for one-tap entry. Empty when N/A. */
  suggestions: QuickSendSuggestion[];
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
  /** Exact sat amount this resolves to (offline-composable) */
  satoshis: number;
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
  /** Returns proof amounts for the selected mint. */
  getProofAmounts: () => number[];
  /** Returns current BTC price in user's fiat currency. */
  getBtcPrice: () => number;
  /**
   * Whether offline proof analysis and fiat-window optimization apply.
   * Set to true for ecash sends, false for receive/melt flows. Pass a getter
   * to track destination changes mid-flow without rebuilding the manager.
   */
  offlineOptimization: boolean | (() => boolean);
  /** Base unit for sat mode (e.g. 'sat'). Pass a getter when the unit can change. */
  unit: string | (() => string);
  /**
   * Fiat currency code (e.g. 'usd'). Enables fiat toggle when both
   * fiatCurrency and fiatSymbol resolve to truthy values. Pass a getter to
   * track display-currency changes mid-flow.
   */
  fiatCurrency?: string | (() => string | undefined);
  /** Fiat currency symbol (e.g. '$'). Enables fiat toggle alongside fiatCurrency. */
  fiatSymbol?: string | (() => string | undefined);
  /** Quick send suggestion config. Omit for defaults, null to disable. */
  quickSendConfig?: QuickSendConfig | null;
}

/**
 * Configuration for quick send suggestion targets and limits.
 */
export interface QuickSendConfig {
  /** Fiat amounts to try (default: broad range from $0.10 to $100) */
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
  /** Set input mode directly (used by suggestion taps). No-op when fiat toggle unavailable. */
  setMode: (mode: AmountInputMode) => void;
  /** Toggle between sat and fiat input modes. No-op when fiat toggle unavailable. */
  toggle: () => void;
  /** Get current resolved state. Stable reference when result unchanged. */
  inspect: () => AmountResolution;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}
