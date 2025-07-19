import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import RouteA from './routeA';

export const sheetName = 'mint-accepter';

export const routes: Route[] = [
  {
    name: 'route-a',
    component: RouteA,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'route-a': RouteDefinition;
      };
      payload: {
        mint: string;
      };
    }>;
  }
}
