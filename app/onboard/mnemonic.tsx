import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Alert,
  ScrollView,
  TextInput,
  Keyboard,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, greys, reds, Theme } from 'helper/colors';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { HStack, VStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import * as nip06 from 'node_modules/nostr-tools/lib/cjs/nip06';
import { wordlist } from '@scure/bip39/wordlists/english';
import BottomButtons from './BottomButtons';

// BIP39 wordlist for validation
const BIP39_WORDLIST = wordlist;

// Grid configuration
const GRID_ROWS = 4;
const GRID_COLS = 3;
const TOTAL_WORDS = GRID_ROWS * GRID_COLS;
const VERIFICATION_INDICES = [2, 5, 11]; // Fixed indices for predictability

const RecoveryScreen: React.FC<{}> = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { type = 'recover', mnemonic = null } = useLocalSearchParams<{
    type?: string;
    mnemonic?: string;
  }>();
  const inputRef = useRef<TextInput>(null);

  // State for managing word input
  const [words, setWords] = useState<string[]>(Array(TOTAL_WORDS).fill(''));
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [invalidWords, setInvalidWords] = useState<number[]>([]);
  const [currentInput, setCurrentInput] = useState('');

  const isVerifyMode = type === 'verify';

  // Set up verification or recovery mode
  useEffect(() => {
    if (isVerifyMode && mnemonic) {
      setVerifyIndices(VERIFICATION_INDICES);

      // Create masked version of the mnemonic
      const mnemonicWords = mnemonic.split(' ');
      const masked = [...mnemonicWords];
      VERIFICATION_INDICES.forEach((index) => {
        masked[index] = '';
      });

      setWords(masked);
      setActiveWordIndex(VERIFICATION_INDICES[0]);
    }
  }, [type, mnemonic]);

  // Focus input when activeWordIndex changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeWordIndex]);

  // Validate a word against BIP39 wordlist
  const isValidBIP39Word = (word: string) => {
    if (!word) return true;
    return BIP39_WORDLIST.some((w) => w.startsWith(word.toLowerCase()));
  };

  // Check if full word is in BIP39
  const isCompleteWord = (word: string) => {
    return BIP39_WORDLIST.includes(word.toLowerCase());
  };

  // Update words and validation
  useEffect(() => {
    const newInvalidWords = words
      .map((word, index) => (word && !isValidBIP39Word(word) ? index : -1))
      .filter((index) => index !== -1);

    setInvalidWords(newInvalidWords);
  }, [words]);

  // Handle text change
  const handleTextChange = (text: string) => {
    // Only allow alphabetic characters
    const alphabeticText = text.replace(/[^a-zA-Z]/g, '').toLowerCase();

    // Update the current input state
    setCurrentInput(alphabeticText);

    // Update words array
    const updatedWords = [...words];
    updatedWords[activeWordIndex] = alphabeticText;
    setWords(updatedWords);

    // If original text includes a space, move to next word
    if (text.includes(' ')) {
      // If it's the last word, submit
      if (activeWordIndex === TOTAL_WORDS - 1) {
        handleSubmit();
      } else {
        handleNextWord();
      }
    }
  };

  // Move to next word
  const handleNextWord = () => {
    if (activeWordIndex >= TOTAL_WORDS - 1) return;

    if (isVerifyMode) {
      // In verify mode, move to the next index that needs verification
      const currentIndexPosition = verifyIndices.indexOf(activeWordIndex);
      if (currentIndexPosition < verifyIndices.length - 1) {
        setActiveWordIndex(verifyIndices[currentIndexPosition + 1]);
        setCurrentInput('');
      }
    } else {
      // Normal recovery mode behavior
      setActiveWordIndex(activeWordIndex + 1);
      setCurrentInput('');
    }
  };

  // Handle submit from keyboard
  const handleSubmitEditing = () => {
    if (activeWordIndex === TOTAL_WORDS - 1) {
      handleSubmit();
    } else {
      handleNextWord();
    }
  };

  // Handle key press for backspace functionality
  const handleKeyPress = ({ nativeEvent }: { nativeEvent: { key: string } }) => {
    // if keypress is next then try to submit
    if (nativeEvent.key === 'Next' && isSubmitEnabled()) {
      handleSubmit();
    }

    if (nativeEvent.key === 'Backspace' && currentInput === '' && activeWordIndex > 0) {
      // Move to previous word if current word is empty and backspace is pressed
      if (isVerifyMode) {
        // In verify mode, move to the previous index that needs verification
        const currentIndexPosition = verifyIndices.indexOf(activeWordIndex);
        if (currentIndexPosition > 0) {
          setActiveWordIndex(verifyIndices[currentIndexPosition - 1]);
          setCurrentInput(words[verifyIndices[currentIndexPosition - 1]]);
        }
      } else {
        // Normal recovery mode behavior
        setActiveWordIndex(activeWordIndex - 1);
        setCurrentInput(words[activeWordIndex - 1]);
      }
    }
  };

  // Handle recovery or verification
  const handleSubmit = () => {
    Keyboard.dismiss();

    if (isVerifyMode) {
      // Verification mode - check if verified words match original
      const originalWords = mnemonic!.split(' ');
      const isCorrect = verifyIndices.every(
        (index) => words[index].toLowerCase() === originalWords[index].toLowerCase()
      );

      if (isCorrect) {
        // All verified words match - continue with onboarding
        Alert.alert('Success!', "You've correctly verified your recovery phrase.", [
          {
            text: 'Continue',
            onPress: () => {
              router.push({
                pathname: '/onboard/animate',
                params: { mnemonic, type: 'new' },
              });
            },
          },
        ]);
      } else {
        Alert.alert(
          'Verification Failed',
          "The words you entered don't match your recovery phrase. Please try again."
        );
      }
    } else {
      // Regular recovery mode
      const invalidWordsCount = invalidWords.length;
      const emptyWordsCount = words.filter((w) => !w).length;

      if (invalidWordsCount > 0) {
        Alert.alert('Error', `You have ${invalidWordsCount} invalid words. Please correct them.`);
        return;
      }

      if (emptyWordsCount > 0) {
        Alert.alert(
          'Error',
          `You have ${emptyWordsCount} empty words. Please complete your seed phrase.`
        );
        return;
      }

      // Proceed with recovery
      const recoveredMnemonic = words.join(' ');
      router.push({
        pathname: '/onboard/animate',
        params: { mnemonic: recoveredMnemonic, type: 'recover' },
      });
    }
  };

  // Render a word cell in the grid
  const renderWordCell = (index: number) => {
    const isActive = index === activeWordIndex;
    const isInvalid = invalidWords.includes(index);
    const isFilled = Boolean(words[index]);
    const isVerifyCell = isVerifyMode && verifyIndices.includes(index);
    const originalWord = mnemonic?.split(' ')[index];

    // Check if the word is correct in verify mode
    const isCorrectWord = words[index]?.toLowerCase() === originalWord?.toLowerCase();

    const isValidWord = isVerifyCell ? isCorrectWord : isFilled && isCompleteWord(words[index]);

    return (
      <TouchableOpacity
        key={`${type}-${index}`}
        style={[
          styles.wordCell,
          isInvalid
            ? styles.invalidWordCell
            : isFilled && isValidWord
              ? styles.validWordCell
              : isFilled
                ? styles.invalidWordCell
                : null,
          isActive && styles.activeWordCell,
        ]}
        onPress={() => {
          setActiveWordIndex(index);
          setCurrentInput(words[index] || '');
        }}>
        <VStack justify="center" flex={1}>
          <Text style={[styles.wordNumber, isActive && styles.activeWordText]}>
            {`${index + 1}.`}
          </Text>
          <Text
            style={[
              styles.wordText,
              isFilled && styles.filledWordText,
              (isVerifyCell ? isCorrectWord : isFilled && isValidWord)
                ? styles.validWordText
                : isInvalid
                  ? styles.invalidWordText
                  : null,
              isActive && styles.activeWordText,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail">
            {words[index] || ''}
          </Text>
        </VStack>
      </TouchableOpacity>
    );
  };

  // Using nip06 to validate mnemonic
  const isValidMnemonic = (mnemonicStr: string) => {
    if (!mnemonicStr) return false;

    try {
      return nip06.validateWords(mnemonicStr);
    } catch (error) {
      return false;
    }
  };

  // Determine if the submit button should be enabled
  const isSubmitEnabled = () => {
    if (isVerifyMode) {
      // For verification, all verify indices should have valid words
      return verifyIndices.every((index) => isCompleteWord(words[index]));
    } else {
      // For recovery, the entire mnemonic should be valid
      return isValidMnemonic(words.join(' '));
    }
  };

  return (
    <>
      <Container>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <Text style={styles.title}>
              {isVerifyMode ? 'Verify your Recovery Phrase' : 'Enter your Recovery Phrase'}
            </Text>

            {isVerifyMode && (
              <Text style={styles.subtitle}>
                {
                  "Please enter the missing words from your recovery phrase to verify you've saved it correctly"
                }
              </Text>
            )}

            <View style={styles.inputContainer}>
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                value={currentInput}
                onChangeText={handleTextChange}
                onSubmitEditing={handleSubmitEditing}
                onKeyPress={handleKeyPress}
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                placeholder={
                  isVerifyMode
                    ? `Enter word ${activeWordIndex + 1}`
                    : `Enter word ${activeWordIndex + 1} of 12`
                }
                placeholderTextColor={greys(theme)[400]}
                returnKeyType={
                  // if on last one
                  activeWordIndex === words.length - 1 ? 'done' : 'next'
                }
              />
            </View>
            <VStack style={styles.gridContainer}>
              {!isVerifyMode ? (
                // For recovery mode, show the full grid
                Array.from({ length: GRID_ROWS }).map((_, rowIndex) => (
                  <HStack key={rowIndex} style={styles.gridRow} justify="space-between">
                    {Array.from({ length: GRID_COLS }).map((_, colIndex) =>
                      renderWordCell(rowIndex * GRID_COLS + colIndex)
                    )}
                  </HStack>
                ))
              ) : (
                // For verify mode, show only the cells that need verification in a single horizontal row
                <HStack style={styles.verifyRow} justify="space-between">
                  {verifyIndices.map((index) => renderWordCell(index))}
                </HStack>
              )}
            </VStack>
          </View>
        </ScrollView>
      </Container>

      <BottomButtons
        buttons={[
          ...(isVerifyMode
            ? []
            : [
                {
                  variant: 'secondary' as const,
                  text: "I can't remember my seed phrase",
                  onPress: () => {},
                },
              ]),
          {
            text: isVerifyMode ? 'Verify' : 'Submit',
            onPress: handleSubmit,
            variant: 'primary' as const,
            disabled: !isSubmitEnabled(),
          },
        ]}
        theme={theme}
        vertical
      />
    </>
  );
};

// Utility function to blend colors
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

  // Parse colors
  const base = parseHex(baseColor);
  const accent = parseHex(accentColor);

  // Blend the colors
  const r = base.r * (1 - intensity) + accent.r * intensity;
  const g = base.g * (1 - intensity) + accent.g * intensity;
  const b = base.b * (1 - intensity) + accent.b * intensity;

  // Return the blended color
  return rgbToHex(r, g, b);
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scrollContainer: {
      flexGrow: 1,
    },
    container: {
      flex: 1,
      backgroundColor: greys(theme)[950],
    },
    title: {
      fontFamily: 'OverpassBold',
      fontSize: 20,
      color: greys(theme)[0],
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: 'OverpassRegular',
      fontSize: 16,
      color: greys(theme)[100],
      marginBottom: 16,
    },
    gridContainer: {
      marginTop: 16,
      marginBottom: 24,
    },
    gridRow: {
      marginBottom: 8,
    },
    verifyRow: {
      marginBottom: 16,
    },
    wordCell: {
      flex: 1,
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      padding: 12,
      marginHorizontal: 4,
      minHeight: 60,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    activeWordCell: {
      backgroundColor: greys(theme)[700],
      borderBottomColor: greys(theme)[400],
    },
    activeWordText: {
      color: greys(theme)[0],
    },
    invalidWordCell: {
      backgroundColor: infuseColors(greys(theme)[950], reds[300]),
      borderBottomColor: reds[300],
    },
    validWordCell: {
      backgroundColor: infuseColors(greys(theme)[950], greens[300]),
      borderBottomColor: greens[300],
    },
    wordNumber: {
      color: greys(theme)[300],
      fontSize: 12,
      marginBottom: 4,
      textAlign: 'left',
    },
    wordText: {
      color: greys(theme)[300],
      textAlign: 'center',
      fontSize: 14,
    },
    filledWordText: {
      color: greys(theme)[100],
    },
    invalidWordText: {
      color: reds[300],
    },
    validWordText: {
      color: greens[300],
    },
    inputContainer: {
      marginBottom: 8,
    },
    textInput: {
      backgroundColor: greys(theme)[800],
      color: greys(theme)[0],
      borderRadius: 8,
      padding: 16,
      fontSize: 16,
      borderWidth: 1,
      borderColor: greys(theme)[700],
    },
  });

export default RecoveryScreen;
