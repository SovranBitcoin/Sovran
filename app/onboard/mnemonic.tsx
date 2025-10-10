import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Alert, ScrollView, TextInput, Keyboard } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { HStack, VStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import * as nip06 from 'nostr-tools/nip06';
import { wordlist } from '@scure/bip39/wordlists/english';
import { cva } from 'class-variance-authority';
import BottomButtons from './BottomButtons';

// BIP39 wordlist for validation
const BIP39_WORDLIST = wordlist;

// Grid configuration
const GRID_ROWS = 4;
const GRID_COLS = 3;
const TOTAL_WORDS = GRID_ROWS * GRID_COLS;
const VERIFICATION_INDICES = [2, 5, 11]; // Fixed indices for predictability

// CVA variants for word cell styling
const wordCellVariants = cva('flex-1 rounded-lg p-3 mx-1 min-h-[60px] border-b-2', {
  variants: {
    state: {
      default: 'bg-primary-800 border-b-transparent',
      active: 'bg-primary-700 border-b-primary-400',
      invalid: 'bg-red-900/40 border-b-red-300',
      valid: 'bg-green-900/40 border-b-green-300',
      filledInvalid: 'bg-red-900/40 border-b-red-300',
    },
  },
  compoundVariants: [
    {
      state: 'valid',
      class: 'bg-green-900/40 border-b-green-300',
    },
    {
      state: 'filledInvalid',
      class: 'bg-red-900/40 border-b-red-300',
    },
    {
      state: 'active',
      class: 'bg-primary-700 border-b-primary-400',
    },
  ],
  defaultVariants: {
    state: 'default',
  },
});

const wordNumberVariants = cva('text-primary-300 text-xs mb-1 text-left', {
  variants: {
    active: {
      true: 'text-primary-0',
      false: '',
    },
  },
  defaultVariants: {
    active: false,
  },
});

const wordTextVariants = cva('text-primary-300 text-center text-sm', {
  variants: {
    filled: {
      true: 'text-primary-100',
      false: '',
    },
    valid: {
      true: 'text-green-300',
      false: '',
    },
    invalid: {
      true: 'text-red-300',
      false: '',
    },
    active: {
      true: 'text-primary-0',
      false: '',
    },
  },
  defaultVariants: {
    filled: false,
    valid: false,
    invalid: false,
    active: false,
  },
});

const RecoveryScreen = () => {
  const { getPrimaryColor } = useTheme();
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

    // Determine if the word is valid based on the mode
    let isValidWord: boolean;
    if (isVerifyCell) {
      // In verify mode: check if it matches the original word
      isValidWord = isCorrectWord;
    } else {
      // In recovery mode: check if it's a complete BIP39 word
      isValidWord = isFilled && isCompleteWord(words[index]);
    }

    // Determine cell state for CVA
    let cellState: 'default' | 'active' | 'invalid' | 'valid' | 'filledInvalid' = 'default';

    if (isFilled) {
      // If the cell has content, determine if it's valid or invalid
      if (isValidWord) {
        cellState = 'valid';
      } else {
        cellState = 'filledInvalid';
      }
    } else if (isActive) {
      // If the cell is empty but active, show active state
      cellState = 'active';
    }
    // If empty and not active, it stays 'default'

    // Debug logging
    if (words[index]) {
      console.log(
        `Cell ${index}: word="${words[index]}", isFilled=${isFilled}, isValidWord=${isValidWord}, isActive=${isActive}, cellState=${cellState}`
      );
    }

    return (
      <TouchableOpacity
        key={`${type}-${index}`}
        className={wordCellVariants({ state: cellState, isActive })}
        onPress={() => {
          setActiveWordIndex(index);
          setCurrentInput(words[index] || '');
        }}>
        <VStack justify="center" flex={1}>
          <Text className={wordNumberVariants({ active: isActive })}>{`${index + 1}.`}</Text>
          <Text
            className={wordTextVariants({
              filled: isFilled,
              valid: isVerifyCell ? isCorrectWord : isFilled && isValidWord,
              invalid: isInvalid,
              active: isActive,
            })}
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
        <ScrollView className="flex-grow px-4" keyboardShouldPersistTaps="handled">
          <View className="flex-1 bg-primary-950">
            {isVerifyMode && (
              <Text className="mb-4 text-base font-normal text-primary-100">
                {
                  "Please enter the missing words from your recovery phrase to verify you've saved it correctly"
                }
              </Text>
            )}

            <View className="mb-2">
              <TextInput
                ref={inputRef}
                className="rounded-lg border border-primary-700 bg-primary-800 p-4 text-base text-primary-0"
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
                placeholderTextColor={getPrimaryColor('400')}
                returnKeyType={
                  // if on last one
                  activeWordIndex === words.length - 1 ? 'done' : 'next'
                }
              />
            </View>
            <VStack className="mb-6 mt-4">
              {!isVerifyMode ? (
                // For recovery mode, show the full grid
                Array.from({ length: GRID_ROWS }).map((_, rowIndex) => (
                  <HStack key={rowIndex} className="mb-2" justify="space-between">
                    {Array.from({ length: GRID_COLS }).map((_, colIndex) =>
                      renderWordCell(rowIndex * GRID_COLS + colIndex)
                    )}
                  </HStack>
                ))
              ) : (
                // For verify mode, show only the cells that need verification in a single horizontal row
                <HStack className="mb-4" justify="space-between">
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
        vertical
      />
    </>
  );
};

export default RecoveryScreen;
