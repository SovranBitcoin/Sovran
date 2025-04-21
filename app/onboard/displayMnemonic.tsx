import React, { useState } from 'react';
import { StyleSheet, View, Alert, ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, greys, reds } from 'helper/colors';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Themed';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import BottomButtons from './BottomButtons';

const MnemonicDisplayScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { mnemonic } = useTypedRoute();
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
    navigation.navigate('onboard/mnemonic', {
      type: 'verify',
      mnemonic,
    });
  };

  const showInfoAlert = () => {
    Alert.alert(
      'Recovery Phrase Information',
      'Your recovery phrase (sometimes called a seed phrase) is a set of 12 words that store all the information needed to recover your wallet. Anyone with access to these words can access your funds, so keep them private and secure.',
      [{ text: 'Got it' }]
    );
  };

  const renderWordCell = (index) => (
    <View key={index} style={styles.wordCell}>
      <Text style={styles.wordNumber}>{`${index + 1}.`}</Text>
      <Text style={styles.wordText} numberOfLines={1} ellipsizeMode="tail">
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

            <View style={styles.gridContainer}>
              {Array.from({ length: 4 }).map((_, rowIndex) => (
                <View key={rowIndex} style={styles.gridRow}>
                  {Array.from({ length: 3 }).map((_, colIndex) =>
                    renderWordCell(rowIndex * 3 + colIndex)
                  )}
                </View>
              ))}
            </View>

            <View style={styles.securityTipsContainer}>
              <Text style={styles.securityTipsTitle}>Security Tips:</Text>
              <Text style={styles.securityTipText}>
                • Write these words down on paper (not digitally)
              </Text>
              <Text style={styles.securityTipText}>• Store in a secure location</Text>
              <Text style={styles.securityTipText}>• Never share with anyone</Text>
              <Text style={styles.securityTipText}>• This phrase controls ALL your funds</Text>
            </View>
          </View>
        </ScrollView>
      </Container>

      <BottomButtons
        buttons={[
          {
            text: 'What is a recovery phrase?',
            onPress: showInfoAlert,
          },
          {
            text: "I've written it down",
            onPress: handleContinue,
            variant: 'primary',
          },
        ]}
        theme={theme}
        vertical
      />
    </>
  );
};

// Helper function for color blending
const infuseColors = (baseColor, accentColor, intensity = 0.075) => {
  // Parse hex colors to RGB
  const parseHex = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  // Convert RGB back to hex
  const rgbToHex = (r, g, b) => {
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

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    backgroundColor: greys('dark')[2300],
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'OverpassBold',
    fontSize: 20,
    color: greys('dark')[0],
    marginBottom: 16,
  },
  instructions: {
    fontSize: 16,
    color: greys('dark')[200],
    marginBottom: 16,
    lineHeight: 22,
  },
  warningContainer: {
    backgroundColor: infuseColors(greys('dark')[2300], reds[300]),
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: reds[300],
  },
  warningText: {
    color: reds[300],
    fontWeight: '600',
  },
  gridContainer: {
    marginTop: 16,
    marginBottom: 24,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  wordCell: {
    flex: 1,
    backgroundColor: greys('dark')[1800],
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    minHeight: 60,
    justifyContent: 'center',
    borderLeftWidth: 3,
    borderLeftColor: greens[300],
  },
  wordNumber: {
    color: greys('dark')[600],
    fontSize: 12,
    marginBottom: 4,
    textAlign: 'left',
  },
  wordText: {
    color: greys('dark')[200],
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  securityTipsContainer: {
    backgroundColor: greys('dark')[1800],
    borderRadius: 8,
    padding: 16,
    marginTop: 8,
  },
  securityTipsTitle: {
    color: greys('dark')[200],
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  securityTipText: {
    color: greys('dark')[400],
    fontSize: 14,
    marginVertical: 4,
  },
});

export default MnemonicDisplayScreen;
