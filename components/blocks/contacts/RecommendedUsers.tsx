import React from 'react';
import { ScrollView } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { VStack, HStack, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Skeleton } from 'components/ui/Skeleton';
import { ProfileImage } from './ProfileImage';
import { UserProfile } from 'helper/apiClient';
import { useTheme } from 'providers/ThemeProvider';

interface RecommendedUsersProps {
  users: UserProfile[];
  onUserPress: (user: UserProfile) => void;
  loading?: boolean;
  isSearching?: boolean;
}

const HORIZONTAL_CARD_SPACING = 8;

export function RecommendedUsers({
  users,
  onUserPress,
  loading = false,
  isSearching = false,
}: RecommendedUsersProps) {
  const { getPrimaryColor } = useTheme();

  const rContentOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity: isSearching ? withTiming(0.6, { duration: 300 }) : withTiming(1, { duration: 300 }),
    };
  });

  if (loading) {
    return (
      <VStack spacing={12}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            overflow: 'visible',
          }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <View
              key={index}
              style={{
                marginRight: index < 4 ? HORIZONTAL_CARD_SPACING : 0,
              }}>
              <View blur className="rounded-lg bg-primary-800 p-3">
                <HStack spacing={8} align="center">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <VStack spacing={2} className="flex-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </VStack>
                </HStack>
              </View>
            </View>
          ))}
        </ScrollView>
      </VStack>
    );
  }

  if (users.length === 0) {
    return null;
  }

  // Always use horizontal layout
  return (
    <VStack spacing={12}>
      <View>
        <Text overpass bold size={14} style={{ color: getPrimaryColor('400') }}>
          Popular users
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          overflow: 'visible',
        }}>
        {users.map((user, index) => (
          <View
            key={user.pubkey}
            style={{
              minWidth: 196,
              marginRight: index < users.length - 1 ? HORIZONTAL_CARD_SPACING : 0,
            }}>
            <View blur className="rounded-lg bg-primary-800 p-3">
              <TouchableOpacity onPress={() => onUserPress(user)}>
                <HStack spacing={8} align="center">
                  <ProfileImage profile={user} loading={false} />
                  <VStack spacing={2} className="flex-1">
                    <Text overpass bold size={14} className="text-primary-50" numberOfLines={1}>
                      {user.displayName || user.name || 'Anonymous'}
                    </Text>
                    {user.nip05 && (
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
          </View>
        ))}
      </ScrollView>
    </VStack>
  );
}
