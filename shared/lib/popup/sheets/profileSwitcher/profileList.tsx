/**
 * @fileoverview ProfileList - Profile switcher sheet content
 *
 * Footer buttons are rendered via BottomSheetFooter in PopupHost.
 * Uses ListGroup + PressableFeedback to match Settings screen row style.
 */

import React from 'react';
import { View } from 'react-native';
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { getUsername } from '@/shared/lib/username';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SheetContent } from '../SheetContent';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import { Section } from '@/features/settings/screens/SettingsScreen';

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
            {profile.cachedBalanceSats != null ? (
              <AmountFormatter
                amount={profile.cachedBalanceSats}
                unit="sat"
                size={12}
                weight="heavy"
              />
            ) : (
              '—'
            )}
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
    <SheetContent title="Select profile">
      <Section title="IMPORTED">
        <ListGroup variant="secondary">{imported.map(renderProfile)}</ListGroup>
      </Section>
      <Section title="DERIVED">
        <ListGroup variant="secondary">{native.map(renderProfile)}</ListGroup>
      </Section>
    </SheetContent>
  );
}
