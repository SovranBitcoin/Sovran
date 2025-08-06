import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import Confirmation from './confirmation';

export const sheetName = 'mint-delete';

export const routes: Route[] = [
  {
    name: 'confirmation',
    component: Confirmation,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        confirmation: RouteDefinition;
      };
      payload: {
        mintUrl: string;
      };
      returnValue: {
        deleted: boolean;
        error?: string;
      };
    }>;
  }
}
