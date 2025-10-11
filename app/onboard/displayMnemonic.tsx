import React, { useState } from 'react';
import { View, Alert, ScrollView } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { VStack, HStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import BottomButtons from './BottomButtons';

const MnemonicDisplayScreen = () => {
  const { getShadeColor } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();
  const [hasConfirmedBackup, setHasConfirmedBackup] = useState(false);

  const words = mnemonic.split(' ');

  const handleContinue = () => {
    if (!hasConfirmedBackup) {
      Alert.alert(
        'Backup Confirmation',
        'Have you written down your recovery phrase in a safe place?',
        [
          { text: "No, I'll do it now", style: 'cancel' },
          {
            text: "Yes, I've written it down",
            onPress: () => {
              setHasConfirmedBackup(true);
              navigateToVerification();
            },
          },
        ]
      );
    } else {
      navigateToVerification();
    }
  };

  const navigateToVerification = () => {
    router.push({
      pathname: '/onboard/mnemonic',
      params: {
        type: 'verify',
        mnemonic,
      },
    });
  };

  const showInfoAlert = () => {
    Alert.alert(
      'Recovery Phrase Information',
      'Your recovery phrase (sometimes called a seed phrase) is a set of 12 words that store all the information needed to recover your wallet. Anyone with access to these words can access your funds, so keep them private and secure.',
      [{ text: 'Got it' }]
    );
  };

  const renderWordCell = (index: number) => (
    <View
      key={index}
      className="border-l-3 mx-1 min-h-[60px] flex-1 justify-center rounded-lg border-shade-300 bg-primary-800 p-3">
      <Text size={12} className="text-left text-primary-300">{`${index + 1}.`}</Text>
      <Text
        testID={`mnemonic-word-${index}`}
        size={14}
        semibold
        className="text-center text-primary-100"
        numberOfLines={1}
        ellipsizeMode="tail">
        {words[index] || ''}
      </Text>
    </View>
  );

  return (
    <>
      <Container>
        <ScrollView className="flex-grow" keyboardShouldPersistTaps="handled">
          <View className="flex-1 bg-primary-950 pb-4">
            <VStack spacing={16}>
              <Text size={20} weight="bold" className="text-primary-0">
                Your Recovery Phrase
              </Text>

              <Text size={16} className="leading-6 text-primary-100">
                These 12 words are the only way to recover your wallet. Write them down in order and
                keep them in a safe place.
              </Text>

              <View
                className="rounded-lg border-l-4 border-shade-300 p-3"
                style={{ backgroundColor: getShadeColor('300') + '0F' }}>
                <Text size={16} weight="semibold" className="text-shade-300">
                  Warning: Never share your recovery phrase with anyone!
                </Text>
              </View>

              <VStack spacing={8} testID="mnemonic-grid">
                {Array.from({ length: 4 }).map((_, rowIndex) => (
                  <HStack key={rowIndex} justify="space-between">
                    {Array.from({ length: 3 }).map((_, colIndex) =>
                      renderWordCell(rowIndex * 3 + colIndex)
                    )}
                  </HStack>
                ))}
              </VStack>

              <View className="rounded-lg bg-primary-800 p-4">
                <VStack spacing={8}>
                  <Text size={16} weight="semibold" className="text-primary-100">
                    Security Tips:
                  </Text>
                  <Text size={14} className="my-1 text-primary-200">
                    • Write these words down on paper (not digitally)
                  </Text>
                  <Text size={14} className="my-1 text-primary-200">
                    • Store in a secure location
                  </Text>
                  <Text size={14} className="my-1 text-primary-200">
                    • Never share with anyone
                  </Text>
                  <Text size={14} className="my-1 text-primary-200">
                    • This phrase controls ALL your funds
                  </Text>
                </VStack>
              </View>
            </VStack>
          </View>
        </ScrollView>
      </Container>

      <BottomButtons
        buttons={[
          {
            variant: 'secondary',
            text: 'What is a recovery phrase?',
            onPress: showInfoAlert,
          },
          {
            variant: 'primary',
            text: "I've written it down",
            onPress: handleContinue,
          },
        ]}
        vertical
      />
    </>
  );
};

export default MnemonicDisplayScreen;
