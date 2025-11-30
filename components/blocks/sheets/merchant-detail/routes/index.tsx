import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import MerchantDetailRoute from './detail';
import { BTCMapPlaceDetails } from 'stores/btcMapStore';

export const sheetName = 'merchant-detail';

export const routes: Route[] = [
  {
    name: 'detail',
    component: MerchantDetailRoute,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        detail: RouteDefinition;
      };
      payload: {
        place: BTCMapPlaceDetails | null;
        isLoading: boolean;
      };
    }>;
  }
}

