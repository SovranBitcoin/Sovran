import { useNavigation, NavigationProp } from 'expo-router';
import { NavigationParams } from '..';
import { SheetManager } from 'react-native-actions-sheet';

// Type the navigation prop
type AppNavigationProp = NavigationProp<NavigationParams>;

export const useTypedNavigation = <T extends keyof NavigationParams>() => {
  const navigation = useNavigation<AppNavigationProp>();
  const navigate = (
    target: T,
    params: NavigationParams[T],
    options?: {
      closeParents?: boolean;
      closeCurrentAndParent?: boolean;
      closeCurrentAndParents?: boolean;
      current: 'drawer';
    }
  ) => {
    // https://github.com/ammarahm-ed/react-native-actions-sheet/issues/346
    SheetManager.hide('button-handler');
    if (options?.closeParents) {
      // Close all parent screens
      let parentNavigation: AppNavigationProp = navigation;
      while (parentNavigation.canGoBack()) {
        parentNavigation.goBack();
        parentNavigation = parentNavigation.getParent<AppNavigationProp>() || parentNavigation;
      }
    } else if (options?.closeCurrentAndParent) {
      // Close the current screen and its immediate parent
      if (navigation.canGoBack()) {
        navigation.goBack(); // Close the current screen
        const parentNavigation = navigation.getParent<AppNavigationProp>();
        if (parentNavigation && parentNavigation.canGoBack()) {
          parentNavigation.goBack(); // Close the parent screen
        }
      }
    } else if (options?.closeCurrentAndParents) {
      // Close the current screen and all parent screens
      if (navigation.canGoBack()) {
        navigation.goBack(); // Close current screen
        let parentNavigation = navigation.getParent<AppNavigationProp>();
        while (parentNavigation && parentNavigation.canGoBack()) {
          parentNavigation.goBack();
          parentNavigation = parentNavigation.getParent<AppNavigationProp>();
        }
      }
    }

    // Perform the navigation
    if (target) {
      setTimeout(() => {
        const { navigate, navigateDeprecated } = navigation;
        switch (options?.current) {
          case 'drawer':
            navigateDeprecated(target, params);
          default:
            navigate(target, params);
        }
      }, 0);
    }
  };

  return { ...navigation, navigate };
};
