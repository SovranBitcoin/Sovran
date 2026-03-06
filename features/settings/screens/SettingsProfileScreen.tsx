import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMnemonic, useCashuMnemonic } from '@/shared/hooks/useSecureStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import Container from '@/shared/ui/composed/Container';
import Icon from 'assets/icons';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import opacity from 'hex-color-opacity';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Button, Card, Description, Input, Label, TextField } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useProfileStore } from '@/shared/stores/global/profileStore';

const DebugRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const foreground = useThemeColor('foreground');
  return (
    <View>
      <Text size={11} style={{ color: opacity(foreground, 0.5) }} className="uppercase">
        {label}
      </Text>
      <Text size={13} style={{ color: opacity(foreground, 0.85) }} className="mt-0.5 font-mono">
        {value}
      </Text>
    </View>
  );
};

export const SettingsProfileScreen = () => {
  const { value: mnemonic, loading: mnemonicLoading } = useMnemonic();
  const { value: cashuMnemonic, loading: cashuMnemonicLoading } = useCashuMnemonic();
  const { keys: nostrKeys, isLoading: nostrKeysLoading } = useNostrKeysContext();
  const mutedColor = useThemeColor('muted');
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });

  const handleCopy = async (text: string, target: CopyTarget) => {
    if (text) {
      await Clipboard.setStringAsync(text);
      copyPopup(target, { duration: 1000 });
    }
  };

  const toggleFieldVisibility = (field: keyof typeof visibleFields) => {
    setVisibleFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const { displayName: username, picture: profilePicture } = useProfileDisplay(
    nostrKeys?.pubkey || ''
  );
  const activeProfile = useProfileStore((s) => s.getActiveProfile());
  const chain = activeProfile?.externalChain ?? (activeProfile?.source === 'imported' ? 1 : 0);

  const renderCopyableDetail = (
    label: string,
    value: string,
    copyTarget: CopyTarget,
    fieldKey: keyof typeof visibleFields | null = null,
    description: string | null = null,
    isLoading: boolean = false
  ) => {
    const showEyeIcon = fieldKey !== null;
    const isVisible = fieldKey ? visibleFields[fieldKey] : true;
    const resolvedValue = isLoading ? 'Loading...' : value || 'N/A';
    const shouldObscure = showEyeIcon && !isVisible;
    const multiline = !shouldObscure && resolvedValue.length > 56;

    return (
      <Card variant="secondary" className="mb-3">
        <Card.Body className="gap-2">
          <TextField>
            <Label>{label}</Label>
            <Input
              value={resolvedValue}
              editable={false}
              secureTextEntry={shouldObscure}
              multiline={multiline}
              numberOfLines={multiline ? 3 : 1}
              className="w-full"
            />
            {!isLoading ? (
              <View className="mt-2 w-full flex-row gap-2">
                {showEyeIcon ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onPress={() => toggleFieldVisibility(fieldKey)}>
                    <Icon
                      name={isVisible ? 'majesticons:eye-off' : 'majesticons:eye'}
                      size={15}
                      color={mutedColor}
                    />
                    <Button.Label className="text-muted">
                      {isVisible ? 'Hide' : 'Show'}
                    </Button.Label>
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className={showEyeIcon ? 'flex-1' : 'w-full'}
                  onPress={() => handleCopy(value, copyTarget)}>
                  <Icon name="lets-icons:copy" size={15} color={mutedColor} />
                  <Button.Label className="text-muted">Copy</Button.Label>
                </Button>
              </View>
            ) : null}
            {description ? <Description>{description}</Description> : null}
          </TextField>
        </Card.Body>
      </Card>
    );
  };

  return (
    <Container>
      <ScrollView className="px-4">
        <Text bold size={13} className="mb-2 ml-2 uppercase tracking-wide">
          Profile Details
        </Text>
        <Card variant="secondary" className="mb-4">
          <Card.Body className="items-center py-5">
            <Avatar
              seed={nostrKeys?.pubkey || ''}
              picture={profilePicture}
              name={username}
              size={72}
            />
            <Card.Title className="mt-3">{username}</Card.Title>
            <Card.Description className="mt-1">
              {nostrKeysLoading ? 'Loading public key...' : nostrKeys?.npub || 'N/A'}
            </Card.Description>
            {chain >= 1 && (
              <Text size={12} medium className="text-foreground/50 mt-1 uppercase tracking-wide">
                chain {chain}
              </Text>
            )}
          </Card.Body>
        </Card>

        {renderCopyableDetail(
          'NIP06:',
          mnemonic || '',
          'mnemonic',
          'mnemonic',
          'Your recovery phrase that gives access to all your nostr & cashu wallets. Everything is derived from this mnemonic so keep it safe and secure!',
          mnemonicLoading
        )}

        {renderCopyableDetail(
          'NPUB:',
          nostrKeys?.npub || '',
          'npub',
          null,
          'Your public identifier on the Nostr network.',
          nostrKeysLoading
        )}

        {renderCopyableDetail(
          'NSEC:',
          nostrKeys?.nsec || '',
          'nsec',
          'nsec',
          'Your private key. Never share this with anyone.',
          nostrKeysLoading
        )}

        {renderCopyableDetail(
          `NUT13:`,
          cashuMnemonic || '',
          'cashuMnemonic',
          'cashuMnemonic',
          'This is a mnemonic you can use in other cashu wallets to recover your funds if you ever want to stop using Sovran.',
          cashuMnemonicLoading
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
      </ScrollView>
    </Container>
  );
};
