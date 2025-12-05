import {
  SET_DISPLAY_BITCOIN,
  SET_LANGUAGE,
  SET_THEME,
  TERMS_ACCEPTED,
  SET_EXPERIMENTAL,
  SET_PASSCODE,
  SET_BACKGROUND_IMAGE,
} from './actionTypes';
import { SettingsAction } from './actions';
import { Reducer } from 'redux';
import { typedUpdate } from 'helper/typedUpdate';

interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

interface Settings {
  lang: string;
  theme: string;
  display_btc: number;
  passcode: string;
  experimental?: boolean;
  backgroundImage?: string;
  termsAccepted: TermsAccepted | null;
}

interface SettingsState {
  settings: Settings;
}

const initialState: SettingsState = {
  settings: {
    lang: 'en',
    theme: 'dark',
    display_btc: 3,
    passcode: '',
    experimental: false,
    termsAccepted: null,
  },
};

export const settingsReducer: Reducer<SettingsState, SettingsAction> = (
  state = initialState,
  action: SettingsAction
): SettingsState => {
  switch (action.type) {
    case SET_DISPLAY_BITCOIN: {
      return typedUpdate('settings.display_btc' as const, () => action.payload, state);
    }
    case SET_LANGUAGE: {
      return typedUpdate('settings.lang' as const, () => action.payload, state);
    }
    case SET_THEME: {
      return typedUpdate('settings.theme' as const, () => action.payload, state);
    }
    case SET_BACKGROUND_IMAGE: {
      return typedUpdate('settings.backgroundImage' as const, () => action.payload, state);
    }
    case TERMS_ACCEPTED: {
      return typedUpdate(
        'settings.termsAccepted' as const,
        () => ({
          termsAccepted: true,
          date: action.payload.date,
        }),
        state
      );
    }
    case SET_EXPERIMENTAL: {
      return typedUpdate('settings.experimental' as const, () => action.payload, state);
    }
    case SET_PASSCODE: {
      return typedUpdate('settings.passcode' as const, () => action.payload, state);
    }
    default: {
      return state;
    }
  }
};
