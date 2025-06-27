import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';
import { computeTintedGreys, shades as baseShades } from 'helper/colors';

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

export const selectBackgroundImageAttrs = createSelector(
  [selectSettings],
  (settings) => settings.backgroundImageAttrs
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
    (state: RootState) => state.settings.settings.theme,
    (state: RootState) => state.settings.settings.backgroundImageAttrs,
  ],
  (themeName: string, attrs) => {
    if (attrs?.shades && attrs?.greys) {
      return {
        shades: attrs.shades,
        greys: attrs.greys,
      };
    }

    return {
      shades: baseShades,
      greys: computeTintedGreys(themeName, baseShades[300]),
    };
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

export const memoizedGetBackgroundImageAttrs = createSelector(
  [
    (state: RootState) => {
      return state.settings.settings.backgroundImageAttrs;
    },
  ],
  (attrs) => attrs
);
