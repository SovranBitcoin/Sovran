import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import SelectMint from './selectMint';

export const sheetName = 'npc-mint-selector';

export const routes: Route[] = [
  {
    name: 'select',
    component: SelectMint,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        select: RouteDefinition;
      };
    }>;
  }
}
