import {
  SET_DISPLAY_BITCOIN,
  SET_LANGUAGE,
  SET_THEME,
  TERMS_ACCEPTED,
  SET_EXPERIMENTAL,
  SET_PASSCODE,
  SET_BACKGROUND_IMAGE,
} from './actionTypes';
import { BACKGROUND_IMAGE_ATTRIBUTES } from '../../backgroundImages';
import { SettingsAction } from './actions';
import _ from 'lodash/fp';
import { RootState } from '../store/reducer';
import { Reducer } from 'redux';
import { typedUpdate } from 'helper/typedUpdate';
export interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

export interface Settings {
  lang: string;
  theme: string;
  display_btc: number;
  passcode: string;
  experimental?: boolean;
  backgroundImage?: string;
  backgroundImageAttrs?: (typeof BACKGROUND_IMAGE_ATTRIBUTES)[string];
  termsAccepted: TermsAccepted | null;
}

export interface SettingsState {
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
      return typedUpdate('settings.display_btc', () => action.payload, state);
    }
    case SET_LANGUAGE: {
      return typedUpdate('settings.lang', () => action.payload, state);
    }
    case SET_THEME: {
      return typedUpdate('settings.theme', () => action.payload, state);
    }
    case SET_BACKGROUND_IMAGE: {
      return typedUpdate('settings', (settings) => ({
        ...settings,
        backgroundImage: action.payload,
        backgroundImageAttrs:
          BACKGROUND_IMAGE_ATTRIBUTES[action.payload] || settings.backgroundImageAttrs,
      }), state);
    }
    case TERMS_ACCEPTED: {
      return typedUpdate('settings.termsAccepted', () => ({
        termsAccepted: true,
        date: action.payload.date,
      }), state);
    }
    case SET_EXPERIMENTAL: {
      return typedUpdate('settings.experimental', () => action.payload, state);
    }
    case SET_PASSCODE: {
      return typedUpdate('settings.passcode', () => action.payload, state);
    }
    default: {
      return state;
    }
  }
};