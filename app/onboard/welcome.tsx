import 'app/global';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Icon, { SovranTextIcon } from 'assets/icons';
import { Text } from 'components/common/Text';
import { VStack, HStack, Spacer } from 'components/common/View';
import { greys, Theme } from 'helper/colors';
import { useTypedNavigation } from 'helper/navigation';
import { LinearGradient } from 'expo-linear-gradient';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  return (
    <VStack flex={1} align="center" justify="center" style={styles.centeredContainer}>
      <VStack
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          backgroundColor: 'black',
        }}>
        {/* <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} />
        <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} />
        <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} /> */}
        <LinearGradient
          colors={['black', 'transparent', 'black']}
          locations={[0, 0.5, 1]}
          style={styles.gradient}
        />
      </VStack>

      <VStack align="center" justify="center" flex={1} spacing={4}>
        <Text size={32} weight="heavy">
          Welcome to
        </Text>
        <SovranTextIcon size={200} />
      </VStack>

      <HStack justify="space-between" style={styles.bottomButtons}>
        <Spacer size={0} />
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => navigation.navigate('onboard/ecash')}>
          <HStack align="center" spacing={8}>
            <Text size={18} weight="bold" style={styles.navButtonText}>
              Next
            </Text>
            <Icon name="fa6-solid:chevron-right" size={20} color={greys(theme)[950]} />
          </HStack>
        </TouchableOpacity>
      </HStack>
    </VStack>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centeredContainer: {
      height: '100%',
      backgroundColor: greys(theme)[950],
    },
    gradient: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    bottomButtons: {
      width: '100%',
      padding: 16,
      position: 'absolute',
      bottom: 16,
    },
    navButton: {
      backgroundColor: greys(theme)[0],
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 12,
    },
    navButtonText: {
      color: greys(theme)[950],
    },
  });
