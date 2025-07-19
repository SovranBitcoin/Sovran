// In reducer.ts
import { ThunkAction, combineReducers } from 'redux';
import { settingsReducer } from '../settings/reducer';
import { cashuReducer } from '../cashu/reducer';
import { bitrefillReducer } from '../bitrefill/reducer';
import { pricelistReducer } from '../pricelist/reducer';
import { vpnReducer } from '../lnvpn/reducer';
import { esimReducer } from '../esim/reducer';
import { nostrReducer } from '../nostr/reducer';
import { SettingsAction } from '../settings';
import { BitrefillAction } from '../bitrefill';
import { CashuAction } from '../cashu';
import { VpnAction } from '../lnvpn';
import { EsimAction } from '../esim';
import { NostrAction } from '../nostr';
import { PricelistAction } from '../pricelist';

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

type Action =
  | SettingsAction
  | CashuAction
  | BitrefillAction
  | VpnAction
  | EsimAction
  | NostrAction
  | PricelistAction
  | typeof RESET_APP;

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
