import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import MainRoute from './main';
import AddCardRoute from './addCard';

// Define a unique name for this sheet
export const sheetName = 'credit-card-sheet';

// Define all available routes for this sheet
export const routes: Route[] = [
  {
    name: 'main',
    component: MainRoute,
  },
  {
    name: 'add-card',
    component: AddCardRoute,
  },
];

// Add TypeScript type definitions
declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        main: RouteDefinition;
        'add-card': RouteDefinition;
      };
    }>;
  }
}
