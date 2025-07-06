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
      payload: {
        accountType?: string;
        accountIndex?: number;
        navigate?: boolean;
        requireBalance?: boolean;
        updateSelectedMint?: boolean;
        allowedMints?: string[];
        onMintPress?: (
          mint: { id: string; unit: string; name: string; iconUrl: string | null }
        ) => void | Promise<void>;
      };
    }>;
  }
}
