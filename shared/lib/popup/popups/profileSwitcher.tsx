/**
 * Profile switcher — opens the canonical bottom-sheet Menu (`actionMenuPopup`)
 * with a custom profile-list header, "Generate new account" / "Import Nostr"
 * trailing items, and a follow-up input menu for nsec import.
 */

import React from 'react';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { getPublicKey, nip19 } from 'nostr-tools';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { getUsername } from '@/shared/lib/username';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import { actionMenuPopup, dismissActionMenuPopup } from './actionMenu';

export type ProfileSwitcherAction =
  | { type: 'switch'; accountIndex: number }
  | { type: 'create' }
  | { type: 'import'; nsec: string; pubkeyHex: string; accountIndex: number };

export interface ProfileSwitcherPayload {
  onRequestAction: (action: ProfileSwitcherAction) => void;
}

const IMPORT_NSEC_LABEL = 'Import Nostr';

function ProfileRow({
  profile,
  isActive,
  onPress,
}: {
  profile: ReturnType<typeof useProfileStore.getState>['profiles'][number];
  isActive: boolean;
  onPress: () => void;
}) {
  const [foreground] = useThemeColor(['foreground'] as const);
  const displayName = profile.cachedDisplayName || getUsername(profile.pubkey);

  const row = (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <Avatar
          state={profile.cachedPicture ? 'image' : 'fallback'}
          seed={profile.pubkey}
          picture={profile.cachedPicture}
          name={displayName}
          size={40}
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
    return <View>{row}</View>;
  }

  return (
    <PressableFeedback animation={false} onPress={onPress}>
      <PressableFeedback.Scale>{row}</PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  // Section title aligned at `ml-3` to match the Menu.Label "Select profile"
  // (also `ml-3`). Rounded card spans full width — no extra horizontal padding,
  // so the rows match the standard menu item indentation.
  return (
    <View className="pt-2 pb-1">
      <Text className="text-foreground/50 ml-3 mb-1 uppercase tracking-wide" size={12} medium>
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl">
        <ListGroup variant="secondary">{children}</ListGroup>
      </View>
    </View>
  );
}

function ProfileSwitcherHeader({ payload }: { payload: ProfileSwitcherPayload }) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  const imported = profiles.filter((p) => p.source === 'imported');
  const native = profiles.filter((p) => p.source !== 'imported');

  const handleSwitch = (accountIndex: number) => {
    payload.onRequestAction({ type: 'switch', accountIndex });
    dismissActionMenuPopup();
  };

  const renderRow = (profile: (typeof profiles)[number]) => (
    <ProfileRow
      key={profile.accountIndex}
      profile={profile}
      isActive={profile.accountIndex === activeAccountIndex}
      onPress={() => handleSwitch(profile.accountIndex)}
    />
  );

  return (
    <View>
      {imported.length > 0 ? (
        <ProfileSection title="IMPORTED">{imported.map(renderRow)}</ProfileSection>
      ) : null}
      <ProfileSection title="DERIVED">{native.map(renderRow)}</ProfileSection>
    </View>
  );
}

function openImportNostrMenu(payload: ProfileSwitcherPayload): void {
  actionMenuPopup({
    title: IMPORT_NSEC_LABEL,
    inputs: [
      {
        id: 'nsec',
        label: 'nsec',
        placeholder: 'nsec1...',
        description: 'Paste your Nostr private key to create an imported profile.',
        secureTextEntry: true,
        autoCapitalize: 'none',
        autoCorrect: false,
      },
    ],
    primaryAction: {
      text: 'Import',
      loadingText: 'Importing...',
      icon: 'mdi:check',
      isDisabled: (values) => !values.nsec?.trim(),
      onPress: (values, { setError, close }) => {
        const trimmed = values.nsec?.trim() ?? '';
        if (!trimmed) {
          setError('Please enter an nsec.');
          return;
        }

        let privateKeyBytes: Uint8Array;
        try {
          const decoded = nip19.decode(trimmed);
          if (decoded.type !== 'nsec') {
            setError('Invalid format. Must be an nsec (nsec1...).');
            return;
          }
          privateKeyBytes = decoded.data;
        } catch {
          setError('Invalid nsec format.');
          return;
        }

        let pubkeyHex: string;
        try {
          pubkeyHex = getPublicKey(privateKeyBytes);
        } catch {
          setError('Failed to derive public key from nsec.');
          return;
        }

        if (useProfileStore.getState().hasPubkey(pubkeyHex)) {
          setError('This identity already exists as a profile.');
          return;
        }

        payload.onRequestAction({
          type: 'import',
          nsec: trimmed,
          pubkeyHex,
          accountIndex: pubkeyToAccountNumber(pubkeyHex),
        });
        close();
      },
    },
  });
}

export function profileSwitcherPopup(payload: ProfileSwitcherPayload): void {
  actionMenuPopup({
    title: 'Select profile',
    header: <ProfileSwitcherHeader payload={payload} />,
    buttons: [
      {
        text: 'Generate new account',
        icon: 'la:user-plus',
        separator: true,
        onPress: () => {
          payload.onRequestAction({ type: 'create' });
        },
      },
      {
        text: IMPORT_NSEC_LABEL,
        icon: 'mdi:key-variant',
        keepOpen: true,
        onPress: () => {
          openImportNostrMenu(payload);
        },
      },
    ],
  });
}
