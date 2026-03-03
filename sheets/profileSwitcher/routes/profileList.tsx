/**
 * @fileoverview ProfileList - Profile switcher sheet content
 *
 * @description
 * Displays all profiles in a vertical list with avatars and names.
 * The active profile is visually highlighted. A "New Profile" option
 * appears at the bottom to add a new account.
 */

import React from 'react';
import { useWindowDimensions } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BottomSheet, Button, Card, Separator } from 'heroui-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { getUsername } from '@/shared/lib/username';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActionSheetPayloads } from '@/shared/lib/popup';

interface ProfileListProps {
  payload: ActionSheetPayloads['profile-switcher'];
  close: () => void;
  onNavigateToImport: () => void;
}

export function ProfileList({ payload, close, onNavigateToImport }: ProfileListProps) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const { height: screenHeight } = useWindowDimensions();

  const handleSwitch = (accountIndex: number) => {
    close();
    setTimeout(() => {
      payload.onSwitchProfile(accountIndex);
    }, 100);
  };

  const handleAddProfile = () => {
    close();
    setTimeout(() => {
      payload.onAddProfile();
    }, 100);
  };

  const imported = profiles.filter((p) => p.source === 'imported');
  const native = profiles.filter((p) => p.source !== 'imported');

  const renderProfile = (profile: (typeof profiles)[0]) => {
    const isActive = profile.accountIndex === activeAccountIndex;
    const displayName = profile.cachedDisplayName || getUsername(profile.pubkey);
    return (
      <Card
        key={profile.accountIndex}
        className="mb-2"
        style={{
          opacity: isActive ? 1 : 0.95,
          backgroundColor: isActive ? opacity(muted, 0.16) : undefined,
          borderColor: isActive ? opacity(muted, 0.45) : opacity(muted, 0.18),
          borderWidth: 1,
        }}>
        <TouchableOpacity onPress={() => handleSwitch(profile.accountIndex)} disabled={isActive}>
          <HStack align="center" spacing={12} justify="space-between" className="px-2 py-1">
            <HStack align="center" spacing={12} className="min-w-0 flex-1">
              <View
                className="shrink-0 rounded-3xl border-2 p-0.5"
                style={{ borderColor: 'transparent' }}>
                <Avatar
                  seed={profile.pubkey}
                  picture={profile.cachedPicture}
                  name={displayName}
                  size={40}
                  variant="person"
                />
              </View>
              <VStack spacing={2} className="min-w-0 flex-1">
                <Text className="text-foreground" size={16} weight="bold" numberOfLines={1}>
                  {displayName}
                </Text>
                {profile.cachedBalanceSats != null ? (
                  <AmountFormatter
                    amount={profile.cachedBalanceSats}
                    unit="sat"
                    size={13}
                    weight="heavy"
                    color={opacity(foreground, 0.45)}
                  />
                ) : (
                  <Text style={{ color: opacity(foreground, 0.45) }} size={12}>
                    —
                  </Text>
                )}
              </VStack>
            </HStack>
            {isActive ? (
              <Icon name="mdi:check-circle" size={22} color={opacity(foreground, 0.45)} />
            ) : (
              <Icon name="mdi:chevron-right" size={22} color={opacity(foreground, 0.28)} />
            )}
          </HStack>
        </TouchableOpacity>
      </Card>
    );
  };

  return (
    <View
      className="bg-surface-secondary mx-4 mb-3 overflow-hidden rounded-[20px] border"
      style={{ borderColor: opacity(muted, 0.2) }}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <BottomSheet.Title className="text-foreground text-xl font-bold">
          Select profile
        </BottomSheet.Title>
        <BottomSheet.Close />
      </View>
      <Separator className="-mx-4" />
      <BottomSheetScrollView
        style={{ maxHeight: screenHeight * 0.48 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}>
        <VStack spacing={16}>
          {imported.length > 0 && (
            <VStack spacing={8}>
              <Text className="text-foreground/50 uppercase tracking-wide" size={13} medium>
                Imported
              </Text>
              {imported.map(renderProfile)}
            </VStack>
          )}
          {native.length > 0 && (
            <VStack spacing={8}>
              <Text className="text-foreground/50 uppercase tracking-wide" size={13} medium>
                Native
              </Text>
              {native.map(renderProfile)}
            </VStack>
          )}
        </VStack>
      </BottomSheetScrollView>
      <View className="bg-surface-secondary pb-safe-offset-3 px-4">
        <Separator className="-mx-4 mb-3" />
        <VStack spacing={10}>
          <Button onPress={handleAddProfile}>
            <Button.Label>Generate new account</Button.Label>
          </Button>
          <Button variant="tertiary" onPress={onNavigateToImport}>
            <Button.Label>Import nsec</Button.Label>
          </Button>
        </VStack>
      </View>
    </View>
  );
}
