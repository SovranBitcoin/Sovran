import {
  SET_DISPLAY_BITCOIN,
  SET_LANGUAGE,
  SET_THEME,
  TERMS_ACCEPTED,
  SET_EXPERIMENTAL,
  SET_PASSCODE,
  SET_BACKGROUND_IMAGE,
} from './actionTypes'
import { BACKGROUND_IMAGE_ATTRIBUTES } from '../../backgroundImages'

const initialState = {
  settings: {
    lang: 'en',
    theme: 'dark',
    backgroundImage: 'bg.png',
    backgroundImageAttrs: BACKGROUND_IMAGE_ATTRIBUTES['bg.png'],
    display_btc: 3,
    passcode: '',
    experimental: false,
    termsAccepted: null,
  },
};

export const settingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_DISPLAY_BITCOIN: {
      return {
        ...state,
        settings: {
          ...state.settings,
          display_btc: action.payload,
        },
      };
    }
    case SET_LANGUAGE: {
      return {
        ...state,
        settings: {
          ...state.settings,
          lang: action.payload,
        },
      };
    }
    case SET_THEME: {
      return {
        ...state,
        settings: {
          ...state.settings,
          theme: action.payload,
        },
      };
    }
    case SET_BACKGROUND_IMAGE: {
      return {
        ...state,
        settings: {
          ...state.settings,
          backgroundImage: action.payload,
          backgroundImageAttrs:
            BACKGROUND_IMAGE_ATTRIBUTES[action.payload] ||
            state.settings.backgroundImageAttrs,
        },
      };
    }
    case TERMS_ACCEPTED: {
      return {
        ...state,
        settings: {
          ...state.settings,
          termsAccepted: {
            termsAccepted: true,
            date: action.payload.date,
          },
        },
      };
    }
    case SET_EXPERIMENTAL: {
      return {
        ...state,
        settings: {
          ...state.settings,
          experimental: action.payload,
        },
      };
    }
    case SET_PASSCODE: {
      return {
        ...state,
        settings: {
          ...state.settings,
          passcode: action.payload,
        },
      };
    }
    default: {
      return state;
    }
  }
};
