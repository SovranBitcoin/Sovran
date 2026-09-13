import { ListRow } from '@/shared/ui/composed/ListRow';
import { avatarStateFor } from '@/shared/lib/imageLoadState';
import { useShiftLogger } from '@/shared/lib/contentShiftLog';
import React, { useEffect, useState } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import Icon from '@/assets/icons';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Button, Card, Description, Input, Label, TextField } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import { log } from '@/shared/lib/logger';

const DebugRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <View>
      <Text size={11} className="text-foreground/50 uppercase">
        {label}
      </Text>
      <Text size={13} className="text-foreground/85 mt-0.5 font-mono">
        {value}
      </Text>
    </View>
  );
};

export function ProfileDetailsScreen({
  mnemonic,
  nostrKeys,
  cashuMnemonic,
  loading = false,
  activeProfile,
  username,
  profilePicture,
  profilePictureResolved,
  rootOnly = false,
  children,
  onBack,
}: {
  mnemonic: string | null;
  nostrKeys: { pubkey: string; npub: string; nsec: string } | null;
  cashuMnemonic: string | null;
  loading?: boolean;
  activeProfile?: ProfileEntry;
  username: string;
  profilePicture?: string;
  /** False while the own kind-0 is still being fetched (neutral placeholder). */
  profilePictureResolved?: boolean;
  rootOnly?: boolean;
  children?: React.ReactNode;
  onBack?: () => void;
}) {
  const mutedColor = useThemeColor('muted');
  const dangerColor = useThemeColor('danger');
  const backgroundColor = useThemeColor('background');
  const shift = useShiftLogger('SettingsProfileScreen');
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active')
        setVisibleFields({ mnemonic: false, nsec: false, cashuMnemonic: false });
    });
    return () => subscription.remove();
  }, []);

  const handleCopy = async (text: string, target: CopyTarget) => {
    if (text) {
      log.info('settings.profile.copy', { target });
      await Clipboard.setStringAsync(text);
      copyPopup(target, { duration: 1000 });
    }
  };

  const toggleFieldVisibility = (field: keyof typeof visibleFields) => {
    log.debug('settings.profile.toggle_visibility', { field });
    setVisibleFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const chain = activeProfile?.externalChain ?? (activeProfile?.source === 'imported' ? 1 : 0);

  const renderCopyableDetail = (
    label: string,
    value: string,
    copyTarget: CopyTarget,
    fieldKey: keyof typeof visibleFields | null = null,
    description: string | null = null,
    isLoading: boolean = false,
    // Fixed per field, never derived from the value's length: the row must
    // measure the same before and after the value arrives (no content shift).
    lines: 1 | 3 = 3
  ) => {
    const showEyeIcon = fieldKey !== null;
    const isVisible = fieldKey ? visibleFields[fieldKey] : true;
    const shouldObscure = showEyeIcon && !isVisible;
    // secureTextEntry ignores multiline, so an obscured secret is one line and
    // only grows when the user reveals it — a shift they caused.
    const multiline = !shouldObscure && lines > 1;

    return (
      <Card variant="secondary" className="mb-3">
        <Card.Body className="gap-2">
          <TextField>
            <Label>{label}</Label>
            <Input
              testID={fieldKey ? `profile-secret-value-${fieldKey}` : undefined}
              value={shouldObscure ? '••••••••' : isLoading ? '' : value || 'N/A'}
              placeholder={isLoading ? 'Loading…' : undefined}
              editable={false}
              secureTextEntry={shouldObscure}
              multiline={multiline}
              numberOfLines={multiline ? lines : 1}
              className="w-full"
            />
            {/* Always mounted: the action row is part of the card's resting
                height, so it must not appear once the value loads. */}
            <View className="mt-2 w-full flex-row gap-2">
              {showEyeIcon ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  isDisabled={!value || loading || isLoading}
                  testID={`profile-reveal-${fieldKey}`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isVisible }}
                  accessibilityValue={{ text: isVisible ? '1' : '0' }}
                  onPress={() => toggleFieldVisibility(fieldKey)}>
                  <Icon
                    name={isVisible ? 'majesticons:eye-off' : 'majesticons:eye'}
                    size={15}
                    color={mutedColor}
                  />
                  <Button.Label className="text-muted">{isVisible ? 'Hide' : 'Show'}</Button.Label>
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className={showEyeIcon ? 'flex-1' : 'w-full'}
                isDisabled={!value || loading || isLoading}
                onPress={() => handleCopy(value, copyTarget)}>
                <Icon name="lets-icons:copy" size={15} color={mutedColor} />
                <Button.Label className="text-muted">Copy</Button.Label>
              </Button>
            </View>
            {description ? <Description>{description}</Description> : null}
          </TextField>
        </Card.Body>
      </Card>
    );
  };

  return (
    <ScreenWrapper
      name="SettingsProfileScreen"
      contentPadding={16}
      footer={
        onBack ? (
          <View className="p-4">
            <Button variant="secondary" onPress={onBack}>
              <Button.Label>Back to review</Button.Label>
            </Button>
          </View>
        ) : undefined
      }>
      <View
        onLayout={(event) => {
          shift.report(
            'settings.profile.shift.content.height',
            'content.height',
            event.nativeEvent.layout.height
          );
        }}>
        {children}
        {!rootOnly && (
          <>
            <Text bold size={13} className="mb-2 ml-2 uppercase tracking-wide">
              Profile info
            </Text>
            <Card variant="secondary" className="mb-4">
              <Card.Body className="gap-3 py-3">
                <View className="flex-row items-center gap-3">
                  <Avatar
                    state={avatarStateFor(profilePicture, profilePictureResolved ?? true)}
                    seed={nostrKeys?.pubkey || ''}
                    picture={profilePicture}
                    name={username}
                    size={56}
                  />
                  <View className="flex-1">
                    <Card.Title numberOfLines={1}>{username}</Card.Title>
                    {/* One line, middle-truncated: an npub is always 63 chars,
                        so the row measures the same loading and loaded. */}
                    <Card.Description className="mt-1" numberOfLines={1} ellipsizeMode="middle">
                      {loading ? 'Loading public key…' : nostrKeys?.npub || 'N/A'}
                    </Card.Description>
                    {chain >= 1 && (
                      <Text
                        size={12}
                        medium
                        className="text-foreground/50 mt-1 uppercase tracking-wide">
                        chain {chain}
                      </Text>
                    )}
                  </View>
                </View>
                {/* The one way in to the kind-0 editor (name, picture,
                    Lightning address, Nostr address, about). */}
                <Button
                  variant="primary"
                  testID="settings-profile-edit"
                  accessibilityLabel="Edit profile"
                  onPress={() => router.push('/(settings-flow)/edit-profile')}>
                  <Icon name="mdi:pencil" size={16} color={backgroundColor} />
                  <Button.Label>Edit profile</Button.Label>
                </Button>
              </Card.Body>
            </Card>
          </>
        )}
        <Text bold size={13} className="mb-2 ml-2 uppercase tracking-wide">
          Keys and recovery
        </Text>

        <Card variant="secondary" className="border-danger bg-danger/[0.08] mb-4 border">
          <Card.Body className="flex-row items-start gap-3 py-4">
            <Icon name="mdi:shield" size={20} color={dangerColor} />
            <View className="flex-1">
              <Text bold size={14} className="text-danger">
                Sovran will never ask for these
              </Text>
              <Text size={13} className="mt-1">
                Your recovery phrase, nsec, and private keys are the keys to your money and
                identity. Never share them with anyone — not even Sovran support. Anyone who asks
                for them is trying to steal from you.
              </Text>
            </View>
          </Card.Body>
        </Card>

        <ListRow
          testID="settings-backup-row"
          title={<Text bold>Back up recovery phrase</Text>}
          accessibilityLabel="Back up recovery phrase"
          onPress={() => {
            setVisibleFields({ mnemonic: false, nsec: false, cashuMnemonic: false });
            router.push('/(prompt-flow)/backup-intro');
          }}
        />

        {renderCopyableDetail(
          'NIP06:',
          mnemonic || '',
          'mnemonic',
          'mnemonic',
          'Root recovery phrase for profiles derived by Sovran. Imported Nostr identities need their own private-key backup. Keep profile identifiers and mint information too.',
          loading
        )}

        {!rootOnly && (
          <>
            {renderCopyableDetail(
              'NPUB:',
              nostrKeys?.npub || '',
              'npub',
              null,
              'Your public identifier on the Nostr network.',
              loading,
              3
            )}

            {renderCopyableDetail(
              'NSEC:',
              nostrKeys?.nsec || '',
              'nsec',
              'nsec',
              'Your private key. Never share this with anyone.',
              loading
            )}

            {renderCopyableDetail(
              `NUT13:`,
              cashuMnemonic || '',
              'cashuMnemonic',
              'cashuMnemonic',
              'Recovery phrase for this profile’s Cashu wallet. Compatible wallets and available mints may restore eligible ecash; this does not guarantee recovery of every token. Back up wallet data and mint information too.',
              loading
            )}
          </>
        )}

        {__DEV__ && activeProfile && (
          <View className="mt-4">
            <Text bold size={13} className="mb-2 ml-2 uppercase tracking-wide">
              Debug (dev only)
            </Text>
            <Card variant="secondary" className="mb-3">
              <Card.Body className="gap-3">
                <DebugRow
                  label="Coco DB"
                  value={
                    activeProfile.accountIndex === 0
                      ? 'coco.db'
                      : `coco-${activeProfile.accountIndex}.db`
                  }
                />
                <DebugRow label="Account index" value={String(activeProfile.accountIndex)} />
                <DebugRow
                  label="Source"
                  value={activeProfile.source === 'imported' ? 'imported' : 'derived'}
                />
                <DebugRow label="External chain" value={String(chain)} />
                <DebugRow
                  label="Nostr path"
                  value={
                    activeProfile.source === 'imported'
                      ? 'Imported nsec (no mnemonic derivation)'
                      : `m/44'/1237'/${activeProfile.accountIndex}'/0/0`
                  }
                />
                <DebugRow
                  label="Cashu path"
                  value={
                    activeProfile.source === 'imported'
                      ? `m/44'/129372'/0'/${activeProfile.accountIndex}'/1/0`
                      : `m/44'/129372'/0'/${activeProfile.accountIndex}'/0/0`
                  }
                />
                {activeProfile.source === 'imported' && (
                  <DebugRow
                    label="npubNumber (from pubkey)"
                    value={String(pubkeyToAccountNumber(activeProfile.pubkey))}
                  />
                )}
              </Card.Body>
            </Card>
          </View>
        )}
      </View>
    </ScreenWrapper>
  );
}
