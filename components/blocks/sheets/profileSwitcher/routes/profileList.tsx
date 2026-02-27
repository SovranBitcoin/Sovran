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
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, ScrollView, useSheetPayload } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Avatar } from 'components/ui/Avatar';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { getUsername } from 'helper/username';
import { useProfileStore } from '@/stores/profileStore';
import { useWindowDimensions } from 'react-native';

const ProfileList = ({ router }: RouteScreenProps<'profile-switcher', 'profile-list'>) => {
  const { getPrimaryColor } = useTheme();
  const payload = useSheetPayload('profile-switcher');
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const { height: screenHeight } = useWindowDimensions();

  const handleSwitch = (accountIndex: number) => {
    router?.close();
    // Small delay to let the sheet close animation start before triggering the switch
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
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: getPrimaryColor('800'),
        borderWidth: 1,
        borderColor: opacity(getPrimaryColor('400'), 0.2),
      }}>
      <ScrollView
        style={{
          maxHeight: screenHeight * 0.6,
          backgroundColor: getPrimaryColor('700'),
        }}
        contentContainerStyle={{
          padding: 16,
        }}
        showsVerticalScrollIndicator>
        <VStack>
          {/* Profile list */}
          {profiles.map((profile) => {
            const isActive = profile.accountIndex === activeAccountIndex;
            return (
              <TouchableOpacity
                key={profile.accountIndex}
                style={{
                  opacity: isActive ? 1 : 0.92,
                  marginBottom: 8,
                  borderRadius: 14,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                  backgroundColor: isActive ? opacity(getPrimaryColor('400'), 0.16) : 'transparent',
                }}
                onPress={() => handleSwitch(profile.accountIndex)}
                disabled={isActive}>
                <HStack align="center" spacing={12}>
                  <View
                    style={{
                      borderRadius: 24,
                      borderWidth: 2,
                      borderColor: isActive ? getPrimaryColor('400') : 'transparent',
                      padding: 2,
                    }}>
                    <Avatar seed={profile.pubkey} size={40} variant="person" />
                  </View>
                  <VStack spacing={2} style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: getPrimaryColor('0'),
                      }}
                      size={16}
                      weight="bold">
                      {getUsername(profile.pubkey)}
                    </Text>
                    {profile.cachedBalanceSats != null ? (
                      <AmountFormatter
                        amount={profile.cachedBalanceSats}
                        unit="sat"
                        size={14}
                        weight="heavy"
                        color={opacity(getPrimaryColor('0'), 0.4)}
                      />
                    ) : (
                      <Text style={{ color: opacity(getPrimaryColor('0'), 0.4) }} size={12}>
                        —
                      </Text>
                    )}
                  </VStack>
                  {isActive && (
                    <Icon
                      name="mdi:check-circle"
                      size={22}
                      color={opacity(getPrimaryColor('0'), 0.4)}
                    />
                  )}
                </HStack>
              </TouchableOpacity>
            );
          })}
        </VStack>
      </ScrollView>
      <View
        style={{
          backgroundColor: getPrimaryColor('700'),
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 16,
        }}>
        <View
          style={{
            height: 1,
            backgroundColor: opacity(getPrimaryColor('400'), 0.15),
            marginBottom: 12,
          }}
        />
        <TouchableOpacity onPress={handleAddProfile}>
          <HStack align="center" spacing={12}>
            <View
              style={{
                backgroundColor: opacity(getPrimaryColor('400'), 0.2),
                borderRadius: 24,
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon name="fluent:add-24-filled" size={24} color={getPrimaryColor('0')} />
            </View>
            <Text
              style={{
                color: getPrimaryColor('0'),
              }}
              size={16}
              weight="bold">
              New Profile
            </Text>
          </HStack>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default ProfileList;
