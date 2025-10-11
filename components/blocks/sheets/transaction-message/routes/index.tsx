/**
 * @fileoverview Route config and types for TransactionMessage
 *
 * @module components/blocks/sheets/transaction-message/routes
 *
 * @description
 * **Routes:**
 * - 'message-input': Text input for optional transaction messages
 *
 * **Data:**
 * - Payload: None (no payload needed)
 * - Route Params: None (single route)
 * - Return: `{action: 'confirm'|'skip', message: string} | undefined` - Via `await SheetManager.show()`
 *
 * **Flow:** message-input → user types message → confirm/skip → close with result OR natural close → undefined
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import MessageInput from './messageInput';

export const sheetName = 'transaction-message';

export const routes: Route[] = [
  {
    name: 'message-input',
    component: MessageInput,
  },
];

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
