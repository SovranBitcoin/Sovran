import React from 'react';
import { ScrollView } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, withDelay } from 'react-native-reanimated';
import { VStack, HStack, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Skeleton } from 'components/ui/Skeleton';
import { ProfileImage } from './ProfileImage';
import { UserProfile } from 'helper/apiClient';
import { useTheme } from 'providers/ThemeProvider';
import { usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';

interface RecommendedUsersProps {
  users: UserProfile[];
  onUserPress: (user: UserProfile) => void;
  loading?: boolean;
  isSearching?: boolean;
}

const HORIZONTAL_CARD_SPACING = 8;

// Create animated versions of components
const AnimatedVStack = Animated.createAnimatedComponent(VStack);
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export function RecommendedUsers({
  users,
  onUserPress,
  loading = false,
  isSearching = false,
}: RecommendedUsersProps) {
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

  // Animate card size and content based on search state
  const rCardStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: isSearching
            ? withTiming(0.8, { duration: 300 })
            : withTiming(1, { duration: 300 }),
        },
      ],
    };
  });

  const rContentOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity: isSearching ? withTiming(0.6, { duration: 300 }) : withTiming(1, { duration: 300 }),
    };
  });

  if (loading) {
    return (
      <AnimatedVStack spacing={12} className="mx-4" style={rOpacityStyle}>
        {/* <Text overpass bold size={14} style={{ color: getPrimaryColor('300') }}>
          Recommended
        </Text> */}
        <AnimatedScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            overflow: 'visible',
          }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Animated.View
              key={index}
              style={[
                {
                  marginRight: index < 4 ? HORIZONTAL_CARD_SPACING : 0,
                },
                // rCardStyle,
              ]}>
              <View blur className="rounded-lg bg-primary-800 p-3">
                <HStack spacing={8} align="center">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <VStack spacing={2} className="flex-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </VStack>
                </HStack>
              </View>
            </Animated.View>
          ))}
        </AnimatedScrollView>
      </AnimatedVStack>
    );
  }

  if (users.length === 0) {
    return null;
  }

  // Always use horizontal layout - no transitions needed
  return (
    <AnimatedVStack spacing={12} className="mx-4" style={rOpacityStyle}>
      <View>
        <Text overpass bold size={14} style={{ color: getPrimaryColor('400') }}>
          Popular users
        </Text>
      </View>
      <AnimatedScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          overflow: 'visible',
        }}>
        {users.map((user, index) => (
          <Animated.View
            key={user.pubkey}
            style={[
              {
                minWidth: 196,
                marginRight: index < users.length - 1 ? HORIZONTAL_CARD_SPACING : 0,
              },
              // rCardStyle,
            ]}>
            <View blur className="rounded-lg bg-primary-800 p-3">
              <TouchableOpacity onPress={() => onUserPress(user)}>
                <HStack spacing={8} align="center">
                  <ProfileImage profile={user} loading={false} />
                  <VStack spacing={2} className="flex-1">
                    <Text overpass bold size={14} className="text-primary-50" numberOfLines={1}>
                      {user.displayName || user.name || 'Anonymous'}
                    </Text>
                    {!isSearching && user.nip05 && (
                      <Animated.View style={rContentOpacityStyle}>
                        <Text
                          overpass
                          regular
                          size={12}
                          style={{
                            color: user.nip05Valid
                              ? getPrimaryColor('300')
                              : getPrimaryColor('500'),
                          }}
                          numberOfLines={1}>
                          {user.nip05Valid ? '✓ ' : '✗ '}
                          {user.nip05}
                        </Text>
                      </Animated.View>
                    )}
                  </VStack>
                </HStack>
              </TouchableOpacity>
            </View>
          </Animated.View>
        ))}
      </AnimatedScrollView>
    </AnimatedVStack>
  );
}
