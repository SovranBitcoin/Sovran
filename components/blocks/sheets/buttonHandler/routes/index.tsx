/**
 * @fileoverview Route config and types for ButtonHandler
 *
 * @module components/blocks/sheets/buttonHandler/routes
 *
 * @description
 * **Routes:**
 * - 'route-a': Dynamic button actions with processing states
 *
 * **Data:**
 * - Payload: `{buttons: ButtonHandlerButton[]}` - Sheet-wide, via `useSheetPayload()`
 * - Route Params: None (single route)
 * - Return: None (buttons handle their own actions)
 *
 * **Flow:** route-a → display buttons → user selects → execute action → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import RouteA from './routeA';
import { ButtonHandlerButton } from 'components/ui/ButtonHandler';

export const sheetName = 'button-handler';

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
        buttons: ButtonHandlerButton[];
      };
    }>;
  }
}
