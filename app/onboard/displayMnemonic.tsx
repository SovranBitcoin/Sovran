import React, { useState } from 'react';
import { StyleSheet, View, Alert, ScrollView } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { VStack, HStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import BottomButtons from './BottomButtons';

const MnemonicDisplayScreen = () => {
  const { getPrimaryColor } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();
  const [hasConfirmedBackup, setHasConfirmedBackup] = useState(false);

  const words = mnemonic.split(' ');
  const styles = createStyles(getPrimaryColor);

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
    <View key={index} style={styles.wordCell}>
      <Text style={styles.wordNumber}>{`${index + 1}.`}</Text>
      <Text
        testID={`mnemonic-word-${index}`}
        style={styles.wordText}
        numberOfLines={1}
        ellipsizeMode="tail">
        {words[index] || ''}
      </Text>
    </View>
  );

  return (
    <>
      <Container>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <VStack spacing={16}>
              <Text style={styles.title}>Your Recovery Phrase</Text>

              <Text style={styles.instructions}>
                These 12 words are the only way to recover your wallet. Write them down in order and
                keep them in a safe place.
              </Text>

              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>
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

              <View style={styles.securityTipsContainer}>
                <VStack spacing={8}>
                  <Text style={styles.securityTipsTitle}>Security Tips:</Text>
                  <Text style={styles.securityTipText}>
                    • Write these words down on paper (not digitally)
                  </Text>
                  <Text style={styles.securityTipText}>• Store in a secure location</Text>
                  <Text style={styles.securityTipText}>• Never share with anyone</Text>
                  <Text style={styles.securityTipText}>• This phrase controls ALL your funds</Text>
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
        theme={theme}
        vertical
      />
    </>
  );
};

// Helper function for color blending
const infuseColors = (baseColor: string, accentColor: string, intensity = 0.075) => {
  // Parse hex colors to RGB
  const parseHex = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  // Convert RGB back to hex
  const rgbToHex = (r: number, g: number, b: number) => {
    return (
      '#' +
      Math.round(r).toString(16).padStart(2, '0') +
      Math.round(g).toString(16).padStart(2, '0') +
      Math.round(b).toString(16).padStart(2, '0')
    );
  };

  const base = parseHex(baseColor);
  const accent = parseHex(accentColor);

  // Blend the colors
  const r = base.r * (1 - intensity) + accent.r * intensity;
  const g = base.g * (1 - intensity) + accent.g * intensity;
  const b = base.b * (1 - intensity) + accent.b * intensity;

  return rgbToHex(r, g, b);
};

const createStyles = (getPrimaryColor: (shade: string) => string) =>
  StyleSheet.create({
    scrollContainer: {
      flexGrow: 1,
    },
    container: {
      flex: 1,
      backgroundColor: getPrimaryColor('950'),
      paddingBottom: 16,
    },
    title: {
      fontFamily: 'OverpassBold',
      fontSize: 20,
      color: getPrimaryColor('0'),
    },
    instructions: {
      fontSize: 16,
      color: getPrimaryColor('100'),
      lineHeight: 22,
    },
    warningContainer: {
      backgroundColor: infuseColors(getPrimaryColor('950'), getShadeColor('300')),
      borderRadius: 8,
      padding: 12,
      borderLeftWidth: 4,
      borderLeftColor: getShadeColor('300'),
    },
    warningText: {
      color: getShadeColor('300'),
      fontWeight: '600',
    },
    wordCell: {
      flex: 1,
      backgroundColor: getPrimaryColor('800'),
      borderRadius: 8,
      padding: 12,
      marginHorizontal: 4,
      minHeight: 60,
      justifyContent: 'center',
      borderLeftWidth: 3,
      borderLeftColor: getShadeColor('300'),
    },
    wordNumber: {
      color: getPrimaryColor('300'),
      fontSize: 12,
      textAlign: 'left',
    },
    wordText: {
      color: getPrimaryColor('100'),
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '600',
    },
    securityTipsContainer: {
      backgroundColor: getPrimaryColor('800'),
      borderRadius: 8,
      padding: 16,
    },
    securityTipsTitle: {
      color: getPrimaryColor('100'),
      fontSize: 16,
      fontWeight: '600',
    },
    securityTipText: {
      color: getPrimaryColor('200'),
      fontSize: 14,
      marginVertical: 4,
    },
  });

export default MnemonicDisplayScreen;
