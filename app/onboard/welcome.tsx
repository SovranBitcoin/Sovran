import 'app/global';
import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Icon, { SovranTextIcon } from 'assets/icons';
import { Text } from 'components/common/Text';
import { greys, Theme } from 'helper/colors';
import { useTypedNavigation } from 'helper/navigation';
import { LinearGradient } from 'expo-linear-gradient';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  return (
    <View style={styles.centeredContainer}>
      <View
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
      </View>
      <View style={styles.centeredContent}>
        <Text size={32} weight="heavy">
          Welcome to
        </Text>
        <View style={styles.spacer} />
        <SovranTextIcon size={200} />
      </View>
      <View style={styles.bottomButtons}>
        <View />
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => navigation.navigate('onboard/ecash')}>
          <Text size={18} weight="bold" style={styles.navButtonText}>
            Next
          </Text>
          <Icon name="fa6-solid:chevron-right" size={20} color={greys(theme)[950]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centeredContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
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
    centeredContent: {
      justifyContent: 'center',
      alignItems: 'center',
      flex: 1,
      alignSelf: 'stretch',
    },
    spacer: {
      marginBottom: 4,
    },
    bottomButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      padding: 16,
      position: 'absolute',
      bottom: 16,
    },
    navButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: greys(theme)[0],
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 12,
    },
    navButtonText: {
      marginRight: 8,
      color: greys(theme)[950],
    },
  });
