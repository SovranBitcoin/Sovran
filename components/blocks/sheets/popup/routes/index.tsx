/**
 * @fileoverview Route config and types for Popup
 *
 * @module components/blocks/sheets/popup/routes
 *
 * @description
 * **Routes:**
 * - 'route-a': Toast notifications, alerts, and modal dialogs
 *
 * **Data:**
 * - Payload: `{variant?: string, emoji?: string, message?: string, submessage?: ReactNode, buttons?: Array}` - Sheet-wide, via `useSheetPayload()`
 * - Route Params: None (single route)
 * - Return: None (auto-dismisses or closes on button press)
 *
 * **Flow:** route-a → display message → auto-dismiss OR button press → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import RouteA from './routeA';

export const sheetName = 'popup-sheet';

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
        variant?: string;
        emoji?: string;
        message?: string;
        submessage?: React.ReactNode;
        buttons?: {
          text: string;
          page?: string;
          onPress?: () => void;
        }[];
      };
    }>;
  }
}
