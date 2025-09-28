import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import RouteA from './routeA';

export const sheetName = 'reallocate-accepter';

export const routes: Route[] = [
  {
    name: 'route-a',
    component: RouteA,
  },
];

interface ReallocationItem {
  fromMint: string;
  toMint: string;
  amount: number;
  unit: string;
  percentage: number;
}

interface MPPAllocationItem {
  mintUrl: string;
  percentage: number;
  amount: number;
}

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'route-a': RouteDefinition;
      };
      payload: {
        reallocations?: ReallocationItem[];
        totalAmount?: number;
        unit: string;
        ignoreDust?: boolean;
        // MPP mode payload
        mode?: 'mpp';
        pr?: string;
        amount?: number;
        pubkey?: string;
        email?: string;
        lud16?: string;
        redirect?: string;
        mppAllocations?: MPPAllocationItem[];
      };
      returnValue: {
        confirmed: boolean;
        ignoreDust?: boolean;
        error?: string;
      };
    }>;
  }
}
