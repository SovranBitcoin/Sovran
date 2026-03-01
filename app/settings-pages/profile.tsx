import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMnemonic, useCashuMnemonic } from 'hooks/useSecureStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import Container from 'components/blocks/Container';
import Icon from 'assets/icons';
import { copyPopup, type CopyTarget } from '@/helper/popup';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { Avatar } from 'components/ui/Avatar';
import { Button, Card, Description, Input, Label, TextField } from 'heroui-native';
import { useThemeColor } from '@/hooks/useThemeColor';
import { getUsername } from '@/helper/username';

const Profile = () => {
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

  const username = getUsername(nostrKeys?.pubkey || '');

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
            <Avatar seed={nostrKeys?.pubkey || ''} name={username} size={72} variant="person" />
            <Card.Title className="mt-3">{username}</Card.Title>
            <Card.Description className="mt-1">
              {nostrKeysLoading ? 'Loading public key...' : nostrKeys?.npub || 'N/A'}
            </Card.Description>
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
      </ScrollView>
    </Container>
  );
};

export default Profile;
