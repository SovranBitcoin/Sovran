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
