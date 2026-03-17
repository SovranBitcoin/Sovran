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
  /** Fiat currency symbol (e.g. '$'). null when fiat toggle unavailable. */
  fiatSymbol: string | null;
}

/**
 * Configuration for creating an AmountActionManager.
 * Uses getter functions so the manager always reads fresh state.
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
   * Set to true for ecash sends, false for receive/melt flows.
   */
  offlineOptimization: boolean;
  /** Base unit for sat mode (e.g. 'sat'). */
  unit: string;
  /** Fiat currency code (e.g. 'usd'). Enables fiat toggle when provided with fiatSymbol. */
  fiatCurrency?: string;
  /** Fiat currency symbol (e.g. '$'). Enables fiat toggle when provided with fiatCurrency. */
  fiatSymbol?: string;
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
  /** Toggle between sat and fiat input modes. No-op when fiat toggle unavailable. */
  toggle: () => void;
  /** Get current resolved state. Stable reference when result unchanged. */
  inspect: () => AmountResolution;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}
