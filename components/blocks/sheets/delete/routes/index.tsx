/**
 * @fileoverview Route config and types for Delete
 *
 * @module components/blocks/sheets/delete/routes
 *
 * @description
 * **Routes:**
 * - 'route-a': Profile deletion confirmation with warnings
 *
 * **Data:**
 * - Payload: None (no payload needed)
 * - Route Params: None (single route)
 * - Return: None (performs destructive action)
 *
 * **Flow:** route-a → display warnings → user confirms → reset app → reload
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import RouteA from './routeA';

export const sheetName = 'delete-router';

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
    }>;
  }
}
