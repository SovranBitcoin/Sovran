import { useEffect } from 'react';
import { useNavigation } from 'expo-router';

import type { SheetRoute } from './sheetRoute';
import type { PickerResult } from './types';

/**
 * Wires a sheet route's screen to its lifecycle, and returns what a tap calls.
 *
 * Leaving by any road (a tap, a pull, the close or back button) ends the
 * sheet, and whoever is still waiting is answered. A screen nobody opened (its
 * open was given up, or it was reached some other way) leaves at once.
 */
export function useSheetRouteScreen<Request>(
  sheet: SheetRoute<Request>
): (result: PickerResult) => void {
  const navigation = useNavigation();

  useEffect(() => {
    const instance = sheet.mounted();
    if (instance === null) navigation.goBack();
    return () => sheet.unmounted(instance);
  }, [sheet, navigation]);

  // Go back from this screen itself, so a tap can only ever close the sheet.
  return (result) => {
    if (sheet.answer(result)) navigation.goBack();
  };
}
