/**
 * Budget for a heroui bottom-sheet host to observe gorhom presenting the sheet
 * (`onAnimate` / `onChange(index >= 0)`) after the sheet mounts open.
 *
 * Gorhom's animate-on-mount waits for its own layout pass (container, handle
 * and — under `enableDynamicSizing` — measured content), so this only has to
 * cover mount + layout of the sheet content. The heaviest menu today (profile
 * switcher: FlashList + avatars) blocked the JS thread for ~700 ms; 2.5 s is
 * ~3x headroom while still recovering quickly from gorhom #2690 / #2719, where
 * the sheet's reanimated reactions die under contention at mount and only a
 * remount brings a working instance back.
 */
export const OPEN_WATCHDOG_MS = 2500;
