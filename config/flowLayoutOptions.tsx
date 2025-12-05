/**
 * @fileoverview Shared modal configuration for flow layouts
 *
 * This file contains shared screen options and components used by all flow layouts
 * (receive-flow, send-flow, mint-flow, transactions-flow) to ensure consistency.
 */

import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { ParamListBase, NavigationProp } from '@react-navigation/native';
import { router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';

type GetPrimaryColor = (shade: string) => string;

/**
 * Shared header button component for flow layouts.
 * Shows close button on first screen, back button on subsequent screens.
 */
const FlowHeaderButton = ({
  isFirstScreen,
  getPrimaryColor,
}: {
  isFirstScreen: boolean;
  getPrimaryColor: GetPrimaryColor;
}) => (
  <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
    <Icon
      name={
        isFirstScreen ? 'material-symbols:close-rounded' : 'material-symbols:arrow-back-rounded'
      }
      size={24}
      color={getPrimaryColor('0')}
    />
  </TouchableOpacity>
);

/**
 * Get the base screen options for flow layouts (used inside modal stacks).
 * These options ensure consistent styling across all flow layouts.
 */
const getBaseFlowScreenOptions = (
  getPrimaryColor: GetPrimaryColor
): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTransparent: true,
  headerStyle: {
    backgroundColor: 'transparent',
  },
  headerTitleStyle: {
    color: getPrimaryColor('0'),
  },
  headerTintColor: getPrimaryColor('0'),
  // Hide any back title that might show parent route names
  headerBackButtonDisplayMode: 'minimal',
  headerBackVisible: false,
  // Horizontal slide animation within the modal
  animation: 'slide_from_right',
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  contentStyle: {
    backgroundColor: getPrimaryColor('950'),
  },
});

/**
 * Create screen options function for flow layouts.
 * This returns a function that can be passed to Stack's screenOptions prop.
 */
export const createFlowLayoutScreenOptions = (getPrimaryColor: GetPrimaryColor) => {
  return ({ navigation }: { navigation: NavigationProp<ParamListBase> }) => {
    // Get the current stack index - 0 means first screen
    const state = navigation.getState();
    const isFirstScreen = state.index === 0;

    return {
      ...getBaseFlowScreenOptions(getPrimaryColor),
      // Dynamic back/close button based on stack depth
      headerLeft: () => (
        <FlowHeaderButton isFirstScreen={isFirstScreen} getPrimaryColor={getPrimaryColor} />
      ),
    };
  };
};

/**
 * Base header options shared across root modal screens.
 * Used by _layout.tsx for consistent header styling.
 */
export const getBaseModalHeaderOptions = (
  getPrimaryColor: GetPrimaryColor,
  backgroundColor: string
): NativeStackNavigationOptions => ({
  headerTitleStyle: {
    color: getPrimaryColor('0'),
  },
  headerTintColor: getPrimaryColor('0'),
  headerBackTitleStyle: {
    fontSize: 16,
  },
  headerStyle: {
    backgroundColor,
  },
  headerLargeStyle: {
    backgroundColor,
  },
});
