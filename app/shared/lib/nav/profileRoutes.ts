import { useLocalSearchParams } from 'expo-router';

/**
 * How a profile page was opened. A `page` is pushed (Search, the drawer, the
 * gallery). A `sheet` rises over a screen that is itself a sheet (a payment,
 * a mint review, the scanner): on iPhone react-native-screens pushes a page
 * that follows a sheet beneath that sheet, so the profile must be a sheet too.
 * Android pushes both. The root stack reads the `entry` param to choose
 * (config/modalScreens.ts `sheet`), and a profile opened as a sheet opens the
 * next profile as one.
 */
type ProfileEntry = 'page' | 'sheet';

type ProfileRouteName = 'profile' | 'share';

type ProfileRouteParamValue = string | number | (string | number)[] | null | undefined;
type ProfileRouteParams = Record<string, ProfileRouteParamValue>;

/** Whether a route's params ask for the sheet presentation. */
export function isSheetEntry(params: unknown): boolean {
  return (
    typeof params === 'object' &&
    params !== null &&
    (params as Record<string, unknown>).entry === 'sheet'
  );
}

export function useProfileEntry(): ProfileEntry {
  return isSheetEntry(useLocalSearchParams()) ? 'sheet' : 'page';
}

export function buildProfileHref<Route extends ProfileRouteName>(
  route: Route,
  params?: ProfileRouteParams,
  entry: ProfileEntry = 'page'
): { pathname: `/${Route}`; params?: ProfileRouteParams } {
  const withEntry = entry === 'sheet' ? { ...params, entry: 'sheet' } : params;
  return {
    pathname: `/${route}`,
    ...(withEntry ? { params: withEntry } : {}),
  };
}

/** A profile opened from a sheet: the scanner, a payment, a mint review. */
export function buildModalProfileHref(params: ProfileRouteParams): {
  pathname: '/profile';
  params?: ProfileRouteParams;
} {
  return buildProfileHref('profile', params, 'sheet');
}
