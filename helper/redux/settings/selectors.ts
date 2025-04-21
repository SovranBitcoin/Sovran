import { createSelector } from 'reselect';

export const selectSettings = (state) => state.settings.settings;

export const selectTheme = createSelector([selectSettings], (settings) => settings.theme);

export const selectLanguage = createSelector([selectSettings], (settings) => settings.lang);

export const selectDisplayBitcoin = createSelector(
  [selectSettings],
  (settings) => settings.display_btc
);

export const memoizedGetTheme = createSelector(
  [
    (state) => {
      return state.settings.settings.theme;
    },
  ],
  (theme) => {
    return theme;
  }
);
