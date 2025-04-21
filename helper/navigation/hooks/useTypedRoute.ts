import { useRoute, RouteProp } from '@react-navigation/native';
import { NavigationParams } from '../types/NavigationParams';

export const useTypedRoute = <T extends keyof NavigationParams>() => {
  const route = useRoute<RouteProp<NavigationParams, T>>();

  if (!route.params) {
    throw new Error(`Route parameters for ${route.name} are undefined`);
  }

  return route.params;
};
