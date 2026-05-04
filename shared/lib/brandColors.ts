/**
 * Cross-feature brand color constants — values that are NOT theme tokens
 * (they don't change between themes) but DO need a single source of truth
 * because they appear at multiple call sites and carry semantic meaning.
 *
 * For theme-aware colors, use `useThemeColor` from `@/shared/hooks/useThemeColor`.
 */

/** Apple system blue (#0A84FF). Used wherever bluetooth / BLE-mesh peer
 *  state is rendered: NetworkSheet, splitBill participant rows. */
export const BLUETOOTH_ACCENT = '#0A84FF';

/** Apple system green (#34C759). Used to indicate live/connected peer or
 *  channel state — bitchat mesh broadcast icon, BLE peer connected dots. */
export const CONNECTED_ACCENT = '#34C759';
