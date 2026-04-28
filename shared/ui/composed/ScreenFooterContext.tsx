import { createContext, useContext } from 'react';

export interface ScreenFooterContextValue {
  setFooterHeight: (height: number) => void;
}

export const ScreenFooterContext = createContext<ScreenFooterContextValue>({
  setFooterHeight: () => {},
});

export const useScreenFooter = () => useContext(ScreenFooterContext);

/**
 * Surfaces the screen's resolved background color to descendants. Used by
 * `ButtonHandler` so the gradient fade behind bottom buttons always ends in
 * the screen's actual background, not just the theme default — keeps the
 * "content disappears into the bar" illusion intact when a screen overrides
 * `bgColor` (image themes, custom backgrounds, etc.).
 *
 * `null` means "no provider above me — fall back to theme background."
 */
export const ScreenBackgroundContext = createContext<string | null>(null);

export const useScreenBackground = () => useContext(ScreenBackgroundContext);
