import React from 'react';
import Animated, { useAnimatedStyle, withTiming, withDelay } from 'react-native-reanimated';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';

// Create animated versions of your components
const AnimatedVStack = Animated.createAnimatedComponent(VStack);

export function EmptyStateView() {
  const { getPrimaryColor } = useTheme();
  const { screenView } = usePaymentsAnimation();

  // Animate opacity with delay to start after blur completes
  const rOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity:
        screenView.value === 'search'
          ? withDelay(600, withTiming(1, { duration: 200 }))
          : withTiming(0, { duration: 200 }),
    };
  });

  return (
    <AnimatedVStack spacing={8} align="center" className="m-6" style={rOpacityStyle}>
      <VStack justify="center" align="center" className="h-20 w-20 rounded-full bg-primary-800">
        <Icon name="majesticons:search-line" size={40} color={getPrimaryColor('400')} />
      </VStack>

      <Text
        className="text-primary-50"
        overpass
        bold
        size={20}
        style={{ color: getPrimaryColor('400') }}>
        Search for Users
      </Text>

      <Text
        className="text-center text-primary-400"
        size={16}
        overpass
        regular
        style={{ color: getPrimaryColor('500') }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      {/* <VStack className="w-full rounded-xl bg-primary-800 p-4">
        <Text overpass bold size={16} style={{ color: getPrimaryColor('300') }}>
          Search Tips:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="ph:user-bold" text="Search by username or display name" />
          <SearchTip icon="solar:key-bold" text="Search by public key" />
          <SearchTip icon="mdi:at" text="Search by NIP-05 identifier" />
        </VStack>
      </VStack> */}
    </AnimatedVStack>
  );
}
