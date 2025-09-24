import { Route } from 'react-native-actions-sheet';
import RouteA from './routeA';
import RouteB from './routeB';

export const sheetName = 'lightning-mpp';

export const routes: Route[] = [
  {
    name: 'route-a',
    component: RouteA,
  },
  {
    name: 'route-b',
    component: RouteB,
  },
];
