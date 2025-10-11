/**
 * @fileoverview Route config and types for EmojiPicker
 *
 * @module components/blocks/sheets/emoji-picker/routes
 *
 * @description
 * **Routes:**
 * - 'emoji-grid': Bitcoin emoji selection interface
 *
 * **Data:**
 * - Payload: `{token: string}` - Sheet-wide, via `useSheetPayload()`
 * - Route Params: None (single route)
 * - Return: None (closes after selection)
 *
 * **Flow:** emoji-grid → user selects emoji → encode → clipboard → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import EmojiGrid from './routeA';

export const sheetName = 'emoji-picker';

export const routes: Route[] = [
  {
    name: 'emoji-grid',
    component: EmojiGrid,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'emoji-grid': RouteDefinition<{ selectedEmoji: string }>;
      };
      payload: {
        token: string;
      };
    }>;
  }
}
