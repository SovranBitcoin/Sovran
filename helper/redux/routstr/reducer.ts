import {
  SET_ROUTSTR_TOKEN,
  SET_ROUTSTR_BALANCE,
  ADD_ROUTSTR_SESSION,
  ADD_ROUTSTR_MESSAGE,
  SET_CURRENT_SESSION,
  SET_LAST_TOKEN,
} from './actionTypes';

export interface RoutstrState {
  token: string;
  balance: number;
  lastToken: string;
  sessions: {
    [id: string]: {
      id: string;
      messages: { role: string; content: string }[];
    };
  };
  currentSessionId: string | null;
}

const initialState: RoutstrState = {
  token: '',
  balance: 0,
  lastToken: '',
  sessions: {},
  currentSessionId: null,
};

export const routstrReducer = (
  state: RoutstrState = initialState,
  action
): RoutstrState => {
  switch (action.type) {
    case SET_ROUTSTR_TOKEN:
      return { ...state, token: action.payload };
    case SET_ROUTSTR_BALANCE:
      return { ...state, balance: action.payload };
    case SET_LAST_TOKEN:
      return { ...state, lastToken: action.payload };
    case ADD_ROUTSTR_SESSION:
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.payload.sessionId]: {
            id: action.payload.sessionId,
            messages: [],
          },
        },
        currentSessionId: action.payload.sessionId,
      };
    case ADD_ROUTSTR_MESSAGE:
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.payload.sessionId]: {
            ...state.sessions[action.payload.sessionId],
            messages: [
              ...(state.sessions[action.payload.sessionId]?.messages || []),
              action.payload.message,
            ],
          },
        },
      };
    case SET_CURRENT_SESSION:
      return { ...state, currentSessionId: action.payload };
    default:
      return state;
  }
};
