/**
 * @fileoverview Route config and types for RoutstrSessions
 *
 * @module components/blocks/sheets/routstr-sessions/routes
 *
 * @description
 * **Routes:**
 * - 'list': Sessions list with ability to switch and create new sessions
 *
 * **Data:**
 * - Payload: None - Sheet-wide, via `useSheetPayload()`
 * - Route Params: None
 * - Return: `{sessionId: string | null}` - Via `await SheetManager.show()` (null if new session)
 *
 * **Flow:** list → user selects session or creates new → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import ListRoute from './list';

export const sheetName = 'routstr-sessions';

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
      returnValue: {
        sessionId: string | null;
      };
      payload: {};
    }>;
  }
}

