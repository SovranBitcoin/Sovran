import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import MessageInput from './messageInput';

// Define a unique name for this sheet
export const sheetName = 'transaction-message';

// Define all available routes for this sheet
export const routes: Route[] = [
  {
    name: 'message-input',
    component: MessageInput,
  },
];

// Add TypeScript type definitions
declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'message-input': RouteDefinition;
      };
      returnValue: {
        action: 'confirm' | 'skip';
        message: string;
      };
    }>;
  }
}
