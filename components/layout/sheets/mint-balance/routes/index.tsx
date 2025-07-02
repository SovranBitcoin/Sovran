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
    }>;
  }
}
