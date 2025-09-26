import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';
import { shades as baseShades, greys, Theme } from 'helper/colors';
import { BACKGROUND_IMAGE_ATTRIBUTES } from 'helper/backgroundImages';

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

export const selectBackgroundImageAttrs = createSelector(
  [selectSettings],
  (settings) => settings.backgroundImageAttrs
);

export const memoizedGetSettings = createSelector([selectSettings], (settings) => {
  return settings;
});

export const memoizedGetTheme = createSelector(
  [
    (state: RootState) => state.settings.settings.theme,
    (state: RootState) => state.settings.settings.backgroundImage,
  ],
  (themeName, image): Theme => {
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
  (image) => {
    return image;
  }
);
