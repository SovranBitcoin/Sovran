import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import ListRoute from './list';
import AddRoute from './add';
import InfoRoute from './info';

export const sheetName = 'mint-balance';

export const routes: Route[] = [
  {
    name: 'list',
    component: ListRoute,
  },
  {
    name: 'add',
    component: AddRoute,
  },
  {
    name: 'info',
    component: InfoRoute,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        list: RouteDefinition;
        add: RouteDefinition;
        info: RouteDefinition;
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
        showAddMintsButton?: boolean;
        showDetailsButton?: boolean;
        onAddMintsPress?: () => void;
        onDetailsPress?: (mintUrl: string) => void;
        mintUrl?: string;
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
