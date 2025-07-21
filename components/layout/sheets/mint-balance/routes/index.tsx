import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import ListRoute from './list';

export const sheetName = 'mint-balance';

export const routes: Route[] = [
  {
    name: 'list',
    component: ListRoute,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        list: RouteDefinition;
      };
      returnValue: {
        id: string;
        name: string;
        iconUrl: string | null;
        unit: string;
      };
      payload: {
        accountType?: string;
        accountIndex?: number;
        navigate?: boolean;
        requireBalance?: boolean;
        updateSelectedMint?: boolean;
        allowedMints?: string[];
        allowedUnits?: string[];
        onMintPress?: (
          mint: {
            id: string;
            unit: string;
            name: string;
            iconUrl: string | null;
          },
          balance: {
            amount: number;
            unit: string;
          }
        ) => void | Promise<void>;
      };
    }>;
  }
}
