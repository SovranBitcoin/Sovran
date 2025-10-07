// In reducer.ts
import { ThunkAction, combineReducers } from 'redux';
import { settingsReducer } from '../settings/reducer';
import { cashuReducer } from '../cashu/reducer';
import { pricelistReducer } from '../pricelist/reducer';
import { nostrReducer } from '../nostr/reducer';
import { SettingsAction } from '../settings';
import { CashuAction } from '../cashu';
import { NostrAction } from '../nostr';
import { PricelistAction } from '../pricelist';

// Action type for reset
export const RESET_APP = 'RESET_APP' as const;

// Define the app reducer with proper typing
const appReducer = combineReducers({
  settings: settingsReducer,
  cashu: cashuReducer,
  pricelist: pricelistReducer,
  nostr: nostrReducer,
});

// Define RootState from the appReducer
export type RootState = ReturnType<typeof appReducer>;

type Action = SettingsAction | CashuAction | NostrAction | PricelistAction | typeof RESET_APP;

// Define AppThunk type for typed thunk actions
export type AppThunk<ReturnType = void> = ThunkAction<
  Promise<ReturnType>,
  RootState,
  unknown,
  Action
>;

// Root reducer with reset functionality and proper typing
const rootReducer = (state: RootState | undefined, action: Action): RootState => {
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

export default rootReducer;
