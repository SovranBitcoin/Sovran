import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';

export const selectSettings = (state: RootState) => state.settings.settings;

export const selectTheme = createSelector([selectSettings], (settings) => settings.theme);

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

export const memoizedGetSettings = createSelector(
  [
    (state: RootState) => {
      return state.settings.settings;
    },
  ],
  (settings) => {
    return settings;
  }
);

export const memoizedGetTheme = createSelector(
  [
    (state: RootState) => {
      return state.settings.settings.theme;
    },
  ],
  (theme: string) => {
    return theme;
  }
);

export const memoizedGetBackgroundImage = createSelector(
  [
    (state: RootState) => {
      return state.settings.settings.backgroundImage;
    },
  ],
  (image: string) => {
    return image;
  }
);
