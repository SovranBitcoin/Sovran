// In reducer.ts
import { AnyAction, ThunkAction, combineReducers } from 'redux';
import { settingsReducer } from '../settings/reducer';
import { cashuReducer } from '../cashu/reducer';
import { bitrefillReducer } from '../bitrefill/reducer';
import { pricelistReducer } from '../pricelist/reducer';
import { vpnReducer } from '../lnvpn/reducer';
import { esimReducer } from '../esim/reducer';
import { nostrReducer } from '../nostr/reducer';
import { persistor } from '.';

// Action type for reset
export const RESET_APP = 'RESET_APP' as const;

// Define the app reducer with proper typing
const appReducer = combineReducers({
  settings: settingsReducer,
  cashu: cashuReducer,
  bitrefill: bitrefillReducer,
  pricelist: pricelistReducer,
  vpns: vpnReducer,
  esim: esimReducer,
  nostr: nostrReducer,
});

// Define RootState from the appReducer
export type RootState = ReturnType<typeof appReducer>;

// Define AppThunk type for typed thunk actions
export type AppThunk<ReturnType = void> = ThunkAction<
  Promise<ReturnType>,
  RootState,
  unknown,
  AnyAction
>;

// Root reducer with reset functionality and proper typing
const rootReducer = (state: RootState | undefined, action: AnyAction): RootState => {
  // If the reset action is fired, return undefined state
  // This will cause each reducer to return their initial state
  if (action.type === RESET_APP) {
    // You can selectively preserve some state if needed
    // const { settings } = state as RootState;
    state = undefined;

    // If you want to preserve some state, you can do:
    // state = { settings } as unknown as RootState;
  }

  return appReducer(state, action);
};

// Typed reset app action creator
export const resetApp = (): AppThunk => {
  return async (dispatch): Promise<void> => {
    try {
      // Clear persisted redux data
      await persistor.purge();

      // Dispatch the reset action to clear the in-memory state
      dispatch({ type: RESET_APP });

      // Restart persistence after reset
      persistor.persist();

      return Promise.resolve();
    } catch (error) {
      console.error('Failed to reset app:', error);
      return Promise.reject(error);
    }
  };
};

export default rootReducer;
