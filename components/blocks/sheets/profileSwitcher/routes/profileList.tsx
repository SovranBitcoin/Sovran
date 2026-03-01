/**
 * @fileoverview ProfileList - Profile switcher sheet content
 *
 * @module components/blocks/sheets/profileSwitcher/routes/profileList
 *
 * @description
 * Displays all profiles in a vertical list with avatars and names.
 * The active profile is visually highlighted. A "New Profile" option
 * appears at the bottom to add a new account.
 */

import React from 'react';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, ScrollView, useSheetPayload } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Avatar } from 'components/ui/Avatar';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { getUsername } from 'helper/username';
import { useProfileStore } from '@/stores/profileStore';
import { useWindowDimensions } from 'react-native';
import { useThemeColor } from 'hooks/useThemeColor';

const ProfileList = ({ router }: RouteScreenProps<'profile-switcher', 'profile-list'>) => {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const payload = useSheetPayload('profile-switcher');
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const { height: screenHeight } = useWindowDimensions();

  const handleSwitch = (accountIndex: number) => {
    router?.close();
    setTimeout(() => {
      payload.onSwitchProfile(accountIndex);
    }, 100);
  };

  const handleAddProfile = () => {
    router?.close();
    setTimeout(() => {
      payload.onAddProfile();
    }, 100);
  };

  return (
    <View
      className="bg-surface-secondary mx-4 mb-3 overflow-hidden rounded-[20px] border"
      style={{ borderColor: opacity(muted, 0.2) }}>
      <ScrollView
        style={{ maxHeight: screenHeight * 0.6 }}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator>
        <VStack>
          {profiles.map((profile) => {
            const isActive = profile.accountIndex === activeAccountIndex;
            const username = getUsername(profile.pubkey);
            return (
              <TouchableOpacity
                key={profile.accountIndex}
                className="mb-2 rounded-[14px] p-2"
                style={{
                  opacity: isActive ? 1 : 0.92,
                  backgroundColor: isActive ? opacity(muted, 0.16) : 'transparent',
                }}
                onPress={() => handleSwitch(profile.accountIndex)}
                disabled={isActive}>
                <HStack align="center" spacing={12}>
                  <View
                    className="rounded-3xl border-2 p-0.5"
                    style={{ borderColor: isActive ? muted : 'transparent' }}>
                    <Avatar seed={profile.pubkey} name={username} size={40} variant="person" />
                  </View>
                  <VStack spacing={2} className="flex-1">
                    <Text className="text-foreground" size={16} weight="bold">
                      {username}
                    </Text>
                    {profile.cachedBalanceSats != null ? (
                      <AmountFormatter
                        amount={profile.cachedBalanceSats}
                        unit="sat"
                        size={14}
                        weight="heavy"
                        color={opacity(foreground, 0.4)}
                      />
                    ) : (
                      <Text style={{ color: opacity(foreground, 0.4) }} size={12}>
                        —
                      </Text>
                    )}
                  </VStack>
                  {isActive && (
                    <Icon name="mdi:check-circle" size={22} color={opacity(foreground, 0.4)} />
                  )}
                </HStack>
              </TouchableOpacity>
            );
          })}
        </VStack>
      </ScrollView>
      <View className="bg-surface-tertiary px-4 pb-4 pt-2">
        <View className="mb-3 h-px" style={{ backgroundColor: opacity(muted, 0.15) }} />
        <TouchableOpacity onPress={handleAddProfile}>
          <HStack align="center" spacing={12}>
            <View
              className="h-11 w-11 items-center justify-center rounded-3xl"
              style={{ backgroundColor: opacity(muted, 0.2) }}>
              <Icon name="fluent:add-24-filled" size={24} color={foreground} />
            </View>
            <Text className="text-foreground" size={16} weight="bold">
              New Profile
            </Text>
          </HStack>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default ProfileList;
