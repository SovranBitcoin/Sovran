import {
  SET_DISPLAY_BITCOIN,
  SET_LANGUAGE,
  SET_THEME,
  SET_EXPERIMENTAL,
  SET_PASSCODE,
  SET_BACKGROUND_IMAGE,
} from './actionTypes';

export const setLanguage = (lang: string) => ({
  type: SET_LANGUAGE,
  payload: lang,
});

export const setTheme = (theme: any) => ({
  type: SET_THEME,
  payload: theme,
});

export const setDisplayBitcoin = (display: number) => ({
  type: SET_DISPLAY_BITCOIN,
  payload: display,
});

export const setExperimental = (experimental: boolean) => ({
  type: SET_EXPERIMENTAL,
  payload: experimental,
});

export const setPasscode = (passcode: string) => ({
  type: SET_PASSCODE,
  payload: passcode,
});

export const setBackgroundImage = (image: string) => ({
  type: SET_BACKGROUND_IMAGE,
  payload: image,
});
