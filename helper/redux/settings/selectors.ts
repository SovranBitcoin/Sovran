import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';
import { shades as baseShades, greys } from 'helper/colors';
import { BACKGROUND_IMAGE_ATTRIBUTES } from 'helper/backgroundImages';

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

export interface Theme {
  id: string;
  greys: {
    0: string;
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    950: string;
  };
  shades: {
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
  };
}

export const memoizedGetTheme = createSelector(
  [
    (state: RootState) => state.settings.settings.theme,
    (state: RootState) => state.settings.settings.backgroundImage,
  ],
  (themeName: string, image: string): Theme => {
    if (image) {
      return BACKGROUND_IMAGE_ATTRIBUTES[image];
    }

    return {
      id: themeName,
      shades: baseShades,
      greys: greys(themeName),
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
