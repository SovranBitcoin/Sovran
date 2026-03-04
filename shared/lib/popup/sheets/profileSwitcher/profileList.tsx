/**
 * @fileoverview ProfileList - Profile switcher sheet content
 *
 * Footer buttons are rendered via BottomSheetFooter in PopupHost.
 * Uses ListGroup + PressableFeedback to match Settings screen row style.
 */

import React from 'react';
import { View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BottomSheet, ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { formatAmount } from '@/shared/lib/currency';
import { getUsername } from '@/shared/lib/username';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActionSheetPayloads } from '../../actionSheetTypes';

interface ProfileListProps {
  payload: ActionSheetPayloads['profile-switcher'];
  close: () => void;
}

export function ProfileList({ payload, close }: ProfileListProps) {
  const [foreground] = useThemeColor(['foreground'] as const);
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  const handleSwitch = (accountIndex: number) => {
    close();
    setTimeout(() => {
      payload.onSwitchProfile(accountIndex);
    }, 100);
  };

  const imported = profiles.filter((p) => p.source === 'imported');
  const native = profiles.filter((p) => p.source !== 'imported');

  const renderProfile = (profile: (typeof profiles)[0]) => {
    const isActive = profile.accountIndex === activeAccountIndex;
    const displayName = profile.cachedDisplayName || getUsername(profile.pubkey);
    const row = (
      <ListGroup.Item disabled>
        <ListGroup.ItemPrefix>
          <Avatar
            seed={profile.pubkey}
            picture={profile.cachedPicture}
            name={displayName}
            size={40}
            variant="person"
          />
        </ListGroup.ItemPrefix>
        <ListGroup.ItemContent>
          <ListGroup.ItemTitle>{displayName}</ListGroup.ItemTitle>
          <ListGroup.ItemDescription>
            {profile.cachedBalanceSats != null
              ? formatAmount(
                  { amount: profile.cachedBalanceSats, unit: 'sat' },
                  { useUserPreference: true }
                )
              : '—'}
          </ListGroup.ItemDescription>
        </ListGroup.ItemContent>
        <ListGroup.ItemSuffix>
          {isActive ? (
            <Icon name="mdi:check-circle" size={20} color={foreground} className="opacity-50" />
          ) : null}
        </ListGroup.ItemSuffix>
      </ListGroup.Item>
    );

    if (isActive) {
      return <View key={profile.accountIndex}>{row}</View>;
    }

    return (
      <PressableFeedback
        key={profile.accountIndex}
        animation={false}
        onPress={() => handleSwitch(profile.accountIndex)}>
        <PressableFeedback.Scale>{row}</PressableFeedback.Scale>
        <PressableFeedback.Ripple />
      </PressableFeedback>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row items-center justify-between">
        <BottomSheet.Title className="text-lg font-bold">Select profile</BottomSheet.Title>
        <BottomSheet.Close />
      </View>
      <BottomSheetScrollView
        style={{ flex: 1, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}>
        <ListGroup variant="secondary">
          {imported.map(renderProfile)}
          {imported.length > 0 && native.length > 0 && (
            <View className="bg-surface-secondary my-2 h-px" />
          )}
          {native.map(renderProfile)}
        </ListGroup>
      </BottomSheetScrollView>
    </View>
  );
}
