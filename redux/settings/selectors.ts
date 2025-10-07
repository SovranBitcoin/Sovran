import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';

export const selectSettings = (state: RootState) => state.settings.settings;

export const selectLanguage = createSelector([selectSettings], (settings) => settings.lang);

export const selectDisplayBitcoin = createSelector(
  [selectSettings],
  (settings) => settings.display_btc
);

export const selectPasscode = createSelector([selectSettings], (settings) => settings.passcode);

export const selectBackgroundImage = createSelector(
  [selectSettings],
  (settings) => settings.backgroundImage
);

// Legacy backgroundImageAttrs selector removed - using human names directly now

export const memoizedGetSettings = createSelector([selectSettings], (settings) => {
  return settings;
});

// Legacy theme selector - now using useTheme hook from ThemeProvider
// export const memoizedGetTheme = createSelector(...)

export const memoizedGetBackgroundImage = createSelector(
  [
    (state: RootState) => {
      return state.settings.settings.backgroundImage;
    },
  ],
  (image) => {
    return image;
  }
);
