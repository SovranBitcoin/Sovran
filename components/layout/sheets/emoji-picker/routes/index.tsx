import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import EmojiGrid from './routeA';

// Define a unique name for this sheet
export const sheetName = 'emoji-picker';

// Define all available routes for this sheet
export const routes: Route[] = [
  {
    name: 'emoji-grid',
    component: EmojiGrid,
  },
];

// Add TypeScript type definitions
declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'emoji-grid': RouteDefinition<{}, { selectedEmoji: string }>;
      };
    }>;
  }
}
