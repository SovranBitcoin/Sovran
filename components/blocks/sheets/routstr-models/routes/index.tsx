/**
 * @fileoverview Route config and types for RoutstrModels
 *
 * @module components/blocks/sheets/routstr-models/routes
 *
 * @description
 * **Routes:**
 * - 'list': Model selection with pricing and details
 *
 * **Data:**
 * - Payload: None - Sheet-wide, via `useSheetPayload()`
 * - Route Params: None
 * - Return: `{modelId: string}` - Via `await SheetManager.show()`
 *
 * **Flow:** list → user selects model → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import ListRoute from './list';

export const sheetName = 'routstr-models';

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
        modelId: string;
      };
      payload: Record<string, never>;
    }>;
  }
}
