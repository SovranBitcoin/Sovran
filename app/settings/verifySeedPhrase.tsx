import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  ScrollView,
  View,
  Text,
  Alert,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { Card } from 'components/common/Card';
import { ButtonHandler } from 'components/common/ButtonHandler';
import NumericKeyboard from 'components/passcode/NumericKeyboard';

const VerifySeedPhrase = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [shuffledWords, setShuffledWords] = useState([]);
  const [selectedWords, setSelectedWords] = useState([]);

  useEffect(() => {
    if (currentProfile?.mnemonic) {
      const words = currentProfile.mnemonic.split(' ');
      setShuffledWords([...words].sort(() => Math.random() - 0.5));
    }
  }, [currentProfile]);


  const isVerified = selectedWords.join(' ') === currentProfile?.mnemonic;

  const handleVerify = () => {
    if (isVerified) {
      Alert.alert('Success', 'Seed Phrase Verified!');
    } else {
      Alert.alert('Error', 'Incorrect Seed Phrase. Please try again.');
    }
  };

  const keyboardKeys = useMemo(() => {
    if (!shuffledWords.length) return [] as any;
    return [
      shuffledWords.slice(0, 3),
      shuffledWords.slice(3, 6),
      shuffledWords.slice(6, 9),
      shuffledWords.slice(9, 12),
      ['', '', '<'],
    ];
  }, [shuffledWords]);

  const handleKeyboardPress = (val: string) => {
    if (val === '<') {
      setSelectedWords((prev) => prev.slice(0, -1));
    } else if (val) {
      setSelectedWords((prev) => [...prev, val]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Verify Seed Phrase</Text>
        <Card
          message="Select the words in the correct order to verify your seed phrase."
          theme={theme}
          variant="info"
        />
        <View style={styles.selectedWordsContainer}>
          <Text style={styles.selectedWordsText}>{selectedWords.join(' ')}</Text>
        </View>
        {isVerified && <Text style={styles.verifiedText}>Seed Phrase Verified!</Text>}
      </ScrollView>
      <View style={styles.buttonContainer}>
        <NumericKeyboard
          accumulate={false}
          keys={keyboardKeys}
          onKeyPress={handleKeyboardPress}
        />
        <ButtonHandler
          buttons={[
            {
              variant: 'secondary',
              onPress: handleVerify,
              text: 'Verify',
            },
          ]}
        />
      </View>
    </SafeAreaView>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
    },
    content: {
      paddingHorizontal: 16,
    },
    sectionTitle: {
      marginVertical: 6,
      marginLeft: 8,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: '500',
      color: greys(theme)[600],
      textTransform: 'uppercase',
    },
    selectedWordsContainer: {
      marginVertical: 8,
      padding: 8,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    selectedWordsText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    verifiedText: {
      color: 'green',
      fontSize: 18,
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: 20,
    },
    buttonContainer: {
      padding: 8,
    },
  });

export default VerifySeedPhrase;
