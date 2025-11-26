/**
 * @fileoverview Receive Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * Screens within this group:
 * - receive: Entry point, shows receive options
 * - currency: Amount selector (pushes horizontally)
 * - mintQuote: Lightning invoice display (pushes horizontally)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';

// Anchor ensures deep-linking maintains navigation context
export const unstable_settings = {
  anchor: 'receive',
};

export default function ReceiveFlowLayout() {
  const { getPrimaryColor } = useTheme();

  // Dynamic header button based on stack depth
  // index > 0 means we're deeper than the first screen
  const HeaderButton = ({ isFirstScreen }: { isFirstScreen: boolean }) => (
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

  return (
    <Stack
      screenOptions={({ navigation }) => {
        // Get the current stack index - 0 means first screen
        const state = navigation.getState();
        const isFirstScreen = state.index === 0;

        return {
          headerShown: true,
          // iOS liquid glass blur effect
          // headerBlurEffect: 'systemMaterialDark',
          headerTransparent: true,
          // Truly transparent background to let blur show through
          headerStyle: {
            backgroundColor: 'transparent',
          },
          headerTitleStyle: {
            color: getPrimaryColor('0'),
          },
          headerTintColor: getPrimaryColor('0'),
          // Dynamic back/close button based on stack depth
          headerLeft: () => <HeaderButton isFirstScreen={isFirstScreen} />,
          // Horizontal slide animation within the modal
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          contentStyle: {
            backgroundColor: getPrimaryColor('950'),
          },
        };
      }}>
      <Stack.Screen name="receive" />
      <Stack.Screen name="currency" options={{ title: 'Select Amount' }} />
      <Stack.Screen name="mintQuote" options={{ title: 'Receive Lightning' }} />
      <Stack.Screen name="receiveToken" options={{ title: 'Receive Ecash' }} />
      <Stack.Screen
        name="camera"
        options={{
          title: 'Scan QR',
          headerStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}
