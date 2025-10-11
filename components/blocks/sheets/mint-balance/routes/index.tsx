/**
 * @fileoverview Route config and types for MintBalance
 *
 * @module components/blocks/sheets/mint-balance/routes
 *
 * @description
 * **Routes:**
 * - 'list': Mint selection with balances and currency filtering
 * - 'add': Discover and add new mints to wallet
 * - 'info': Detailed mint information and audit data
 *
 * **Data:**
 * - Payload: `{requireBalance?: boolean, showAddMintsButton?: boolean, onMintPress?: function}` - Sheet-wide, via `useSheetPayload()`
 * - Route Params: `{mintUrl: string}` - Passed via `router.navigate('info', {mintUrl})`
 * - Return: `{id: string, name: string, iconUrl: string|null, unit: string}` - Via `await SheetManager.show()`
 *
 * **Flow:** list → user selects mint → close OR list → add → discover mints → add → close OR list → info → inspect details → close
 */

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
        info: RouteDefinition<{ mintUrl: string }>;
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
