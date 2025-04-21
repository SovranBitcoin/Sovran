// In reducer.ts
import { combineReducers } from 'redux';
import { settingsReducer } from '../settings/reducer';
import { cashuReducer } from '../cashu/reducer';
import { bitrefillReducer } from '../bitrefill/reducer';
import { pricelistReducer } from '../pricelist/reducer';
import { vpnReducer } from '../lnvpn/reducer';
import { esimReducer } from '../esim/reducer';
import { nostrReducer } from '../nostr/reducer';
import { persistor } from '.';

// Action type for reset
export const RESET_APP = 'RESET_APP';

const appReducer = combineReducers({
  settings: settingsReducer,
  cashu: cashuReducer,
  bitrefill: bitrefillReducer,
  pricelist: pricelistReducer,
  vpns: vpnReducer,
  esim: esimReducer,
  nostr: nostrReducer,
});

export type RootState = ReturnType<typeof appReducer>;

// Root reducer with reset functionality
const rootReducer = (state: any, action: any) => {
  // If the reset action is fired, return undefined state
  // This will cause each reducer to return their initial state
  if (action.type === RESET_APP) {
    // You can selectively preserve some state if needed
    // const { settings } = state;
    state = undefined;

    // If you want to preserve some state, you can do:
    // state = { settings };
  }

  return appReducer(state, action);
};

export const resetApp = () => {
  // First, purge the redux-persist storage
  return async (dispatch: any) => {
    // Clear persisted redux data
    await persistor.purge();

    // Dispatch the reset action to clear the in-memory state
    dispatch({ type: RESET_APP });

    // Optionally, you can restart persistence after reset
    persistor.persist();

    return Promise.resolve();
  };
};

export default rootReducer;
