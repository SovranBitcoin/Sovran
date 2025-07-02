import React, { useState, useEffect, useRef } from 'react';
import { Dimensions, View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { greys, shades, white } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Container from 'components/layout/Container';
import { CheckIcon } from 'assets/icons';
import { Text } from 'components/common/Text';
import { useNostr } from 'helper/redux/nostr';
import { Card } from 'components/common/Card';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { ButtonHandler } from 'components/common/ButtonHandler';

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
      height: Dimensions.get('screen').height - 128,
      margin: 12,
    },
    content: {},
    titleText: {
      textAlign: 'center',
      fontSize: 32,
      fontFamily: 'OverpassHeavy',
      color: shades[300],
    },
    inputSelectorContainer: {
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: greys(theme)[950],
      marginVertical: 8,
    },
    input: {
      color: greys(theme)[50],
      backgroundColor: greys(theme)[950],
      padding: 8,
      paddingVertical: 16,
      borderRadius: 8,
      textAlign: 'center',
      fontSize: 16,
    },
    picker: {
      color: greys(theme)[0],
    },
    costText: {
      textAlign: 'left',
      fontSize: 18,
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
    },
    buttonContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      overflow: 'hidden',
      width: '100%',
      marginVertical: 8,
      padding: 10,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
      backgroundColor: white,
      padding: 20,
      borderRadius: 10,
      width: '80%',
      alignItems: 'center',
    },
    closeButton: {
      marginTop: 10,
      padding: 10,
      borderRadius: 5,
      backgroundColor: greys(theme)[100],
    },
    closeButtonText: {
      color: greys(theme)[0],
      textAlign: 'center',
    },
    nameAvailabilityContainer: {
      marginTop: 8,
    },
    nameAvailabilityItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderRadius: 8,
      backgroundColor: greys(theme)[800],
      marginBottom: 8,
    },
    nameAvailabilityText: {
      color: greys(theme)[500],
      fontSize: 14,
    },
    checkIconContainer: {
      backgroundColor: 'transparent',
      marginLeft: 8,
      padding: 0, // Ensure no padding is added
    },
    buyButton: {
      marginTop: 20,
    },
    buyButtonText: {
      color: white,
      fontSize: 16,
      fontWeight: 'bold',
    },
  });

const checkNameAvailability = async (name: string, domain: string) => {
  try {
    const response = await fetch(`${domain} /.well-known/nostr.json?name=${name}`);
    const data = await response.json();
    return !data.names || Object.keys(data.names).length === 0;
  } catch {
    return false;
  }
};

const NpubSelector = ({
  username,
  setUsername,
  selectedDomain,
  setSelectedDomain,
}: {
  username: string;
  setUsername: (value: string) => void;
  selectedDomain: string;
  setSelectedDomain: (value: string) => void;
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [nameAvailability, setNameAvailability] = useState<{ name: string; available: boolean }[]>(
    []
  );
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { showActionSheetWithOptions } = useActionSheet();

  useEffect(() => {
    if (currentProfile?.name) {
      const baseName = currentProfile.name.replace(' ', '');
      const variants = [
        baseName,
        `${baseName.replace(' ', '_')}`,
        `${baseName.replace(' ', '-')}`,
        `${baseName.replace(' ', '')}`,
        `${baseName}btc`,
        `zap${baseName}`,
      ];
      const uniqueVariants = Array.from(new Set(variants));
      const checks = uniqueVariants.map((variant) => ({
        name: variant,
        domain: selectedDomain,
      }));

      Promise.all(
        checks.map((check) =>
          checkNameAvailability(check.name, check.domain).then((available) => ({
            name: `${check.name}${check.domain}`,
            available,
          }))
        )
      ).then((results) => {
        setNameAvailability(results);
      });
    }
  }, [currentProfile?.name, selectedDomain]);

  useEffect(() => {
    const names = ['Satoshi', 'Laura', 'Nakamoto', 'Andreas', 'Hal', 'Finney', 'Nick', 'Calle'];
    const usedNames = new Set<string>();
    let currentCharIndex = 0;
    let isDeleting = false;
    let currentName = '';

    const getRandomName = () => {
      if (usedNames.size === names.length) {
        usedNames.clear(); // Reset if all names have been used
      }
      let randomName;
      do {
        randomName = names[Math.floor(Math.random() * names.length)];
      } while (usedNames.has(randomName));
      usedNames.add(randomName);
      return randomName;
    };

    const type = () => {
      if (!currentName || isDeleting) {
        if (currentCharIndex > 0) {
          setPlaceholder((prev) => prev.slice(0, -1));
          currentCharIndex--;
        } else {
          isDeleting = false;
          currentName = getRandomName();
          currentCharIndex = 0;
        }
      } else {
        if (currentCharIndex < currentName.length) {
          const nextChar = currentName[currentCharIndex];
          if (nextChar) {
            setPlaceholder((prev) => prev + nextChar);
            currentCharIndex++;
          }
        } else {
          isDeleting = true;
        }
      }
    };

    const typingInterval = setInterval(type, 200);
    return () => clearInterval(typingInterval);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleNameClick = (name: string) => {
    setSelectedName(name);
    const [newName, newDomain] = name.split('@');
    setUsername(newName);
    setSelectedDomain(`@${newDomain}`);
  };

  const handleDomainPress = () => {
    const options = ['@sovran.money', '@sovran.cash', '@sovran.id', '@npubx.cash', 'Cancel'];
    const cancelButtonIndex = 4;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelButtonIndex) {
          setSelectedDomain(options[buttonIndex]);
        }
      }
    );
  };

  return (
    <View style={styles.inputSelectorContainer}>
      <View
        style={{
          backgroundColor: greys(theme)[800],
          padding: 8,
          borderRadius: 8,
          marginBottom: 8,
        }}>
        <TextInput
          ref={inputRef}
          placeholder={placeholder}
          value={username}
          onChangeText={setUsername}
          style={styles.input}
          placeholderTextColor={greys(theme)[50]}
        />
        <ButtonHandler
          buttons={[
            {
              variant: 'primary',
              onPress: handleDomainPress,
              text: selectedDomain,
              icon: 'fluent:chevron-down-12-filled',
            },
          ]}
        />
      </View>
      <Text style={styles.costText}>Available domains</Text>
      {nameAvailability.length > 0 && (
        <View style={styles.nameAvailabilityContainer}>
          {nameAvailability.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.nameAvailabilityItem}
              onPress={() => handleNameClick(item.name)}>
              <Text style={styles.nameAvailabilityText}>{item.name}</Text>
              {selectedName === item.name && (
                <View style={styles.checkIconContainer}>
                  <CheckIcon color={greys(theme)[0]} style={{}} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [username, setUsername] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('https://npubx.cash');

  const handleBuy = () => {
    // Implement the buy functionality here
  };

  return (
    <Container>
      <View style={styles.content}>
        <NpubSelector
          username={username}
          setUsername={setUsername}
          selectedDomain={selectedDomain}
          setSelectedDomain={setSelectedDomain}
        />
        <Card message="Cost: 5000 sats (subject to change)" variant="info" />
        <ButtonHandler
          buttons={[
            {
              variant: 'primary',
              onPress: handleBuy,
              text: 'Buy',
            },
          ]}
        />
      </View>
    </Container>
  );
}
