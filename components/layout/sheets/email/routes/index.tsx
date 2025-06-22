import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import EmailInput from './emailInput';

// Define a unique name for this sheet
export const sheetName = 'email-sheet';

// Define all available routes for this sheet
export const routes: Route[] = [
  {
    name: 'email',
    component: EmailInput,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        email: RouteDefinition<{
          onConfirm?: (email: string) => void;
          confirmed: boolean;
          email?: string;
        }>;
      };
    }>;
  }
}
