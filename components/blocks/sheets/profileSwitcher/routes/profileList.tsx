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
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Avatar } from 'components/ui/Avatar';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { getUsername } from 'helper/username';
import { useProfileStore } from '@/stores/profileStore';
import { router as expoRouter } from 'expo-router';

const ProfileList = ({ router }: RouteScreenProps<'profile-switcher', 'profile-list'>) => {
  const { getPrimaryColor } = useTheme();
  const payload = useSheetPayload('profile-switcher');
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

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

  const handleRecoverWallet = () => {
    router?.close();
    setTimeout(() => {
      expoRouter.navigate('/settings-pages/recovery' as any);
    }, 100);
  };

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: getPrimaryColor('800'),
      }}>
      <VStack
        style={{
          backgroundColor: getPrimaryColor('700'),
          padding: 16,
          borderRadius: 16,
        }}>
        {/* Profile list */}
        {profiles.map((profile) => {
          const isActive = profile.accountIndex === activeAccountIndex;
          return (
            <TouchableOpacity
              key={profile.accountIndex}
              style={{
                opacity: isActive ? 1 : 0.8,
                marginBottom: 8,
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
                      color={getPrimaryColor('400')}
                    />
                  ) : (
                    <Text style={{ color: getPrimaryColor('400') }} size={12}>
                      —
                    </Text>
                  )}
                </VStack>
                {isActive && (
                  <Icon name="mdi:check-circle" size={22} color={getPrimaryColor('400')} />
                )}
              </HStack>
            </TouchableOpacity>
          );
        })}

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: opacity(getPrimaryColor('400'), 0.15),
            marginVertical: 8,
          }}
        />

        {/* Add new profile */}
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

        {/* Recover wallet (dev only) */}
        {__DEV__ && (
          <TouchableOpacity onPress={handleRecoverWallet} style={{ marginTop: 8 }}>
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
                <Icon name="mdi:refresh" size={24} color={getPrimaryColor('0')} />
              </View>
              <Text
                style={{
                  color: getPrimaryColor('0'),
                }}
                size={16}
                weight="bold">
                Recover Wallet
              </Text>
            </HStack>
          </TouchableOpacity>
        )}
      </VStack>
    </View>
  );
};

export default ProfileList;
