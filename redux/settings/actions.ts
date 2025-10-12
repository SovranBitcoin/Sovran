import {
  SET_DISPLAY_BITCOIN,
  SET_THEME,
  SET_PASSCODE,
  SET_BACKGROUND_IMAGE,
  TERMS_ACCEPTED,
} from './actionTypes';

export type SettingsAction =
  | ReturnType<typeof setTheme>
  | ReturnType<typeof setDisplayBitcoin>
  | ReturnType<typeof setPasscode>
  | ReturnType<typeof setBackgroundImage>
  | ReturnType<typeof termsAccepted>;

export const setTheme = (theme: string) =>
  ({
    type: SET_THEME,
    payload: theme,
  }) as const;

export const setDisplayBitcoin = (display: number) =>
  ({
    type: SET_DISPLAY_BITCOIN,
    payload: display,
  }) as const;

export const setPasscode = (passcode: string) =>
  ({
    type: SET_PASSCODE,
    payload: passcode,
  }) as const;

export const setBackgroundImage = (image: string) =>
  ({
    type: SET_BACKGROUND_IMAGE,
    payload: image,
  }) as const;

export const termsAccepted = (date: string) =>
  ({
    type: TERMS_ACCEPTED,
    payload: {
      date,
    },
  }) as const;
