/**
 * @fileoverview Route config and types for ProfileSwitcher
 *
 * @module components/blocks/sheets/profileSwitcher/routes
 *
 * @description
 * **Routes:**
 * - 'profile-list': Vertical list of profiles + "New Profile" action
 *
 * **Data:**
 * - Payload: `{ onSwitchProfile, onAddProfile }` callbacks
 * - Route Params: None (single route)
 *
 * **Flow:** profile-list → user selects profile → execute switch → close
 */

import { Route, SheetDefinition, RouteDefinition } from 'react-native-actions-sheet';
import ProfileList from './profileList';
import ImportNsec from './importNsec';

export const sheetName = 'profile-switcher';

export const routes: Route[] = [
  {
    name: 'profile-list',
    component: ProfileList,
  },
  {
    name: 'import-nsec',
    component: ImportNsec,
  },
];

declare module 'react-native-actions-sheet' {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        'profile-list': RouteDefinition;
        'import-nsec': RouteDefinition;
      };
      payload: {
        onSwitchProfile: (accountIndex: number) => void;
        onAddProfile: () => void;
        onImportProfile?: (npubNumber: number) => void;
      };
    }>;
  }
}
