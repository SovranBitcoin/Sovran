import { SET_DISPLAY_BITCOIN, SET_LANGUAGE, SET_THEME } from "./actionTypes";

export const setLanguage = (lang: string) => ({
  type: SET_LANGUAGE,
  payload: lang,
});

export const setTheme = (theme: string) => ({
  type: SET_THEME,
  payload: theme,
});

export const setDisplayBitcoin = (display: number) => ({
  type: SET_DISPLAY_BITCOIN,
  payload: display,
});