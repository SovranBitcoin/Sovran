import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'components/common/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { greys } from 'helper/colors';
import lookup from 'country-code-lookup';

const VpnComponent = ({ esim, theme, isReceived }) => {
  const styles = createStyles(theme, isReceived);

  return (
    <View style={styles.transactionWrapper}>
      <View style={styles.arrow}></View>
      <LinearGradient
        colors={isReceived ? [theme.greys[1000], theme.greys[1200]] : [theme.shades[100], theme.shades[300]]}
        style={styles.transactionContainer}>
        <View style={styles.labelContainer}>
          <Text style={styles.labelText}>You received a VPN</Text>
        </View>
        <Text style={styles.transactionText}>
          {lookup.byIso(esim.location).country + ', ' + esim.duration + ' plan'}
        </Text>
        <Text style={styles.timestamp}>{convertTime(new Date(esim?.created_at))}</Text>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme, isReceived) =>
  StyleSheet.create({
    transactionWrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
      alignSelf: isReceived ? 'flex-start' : 'flex-end',
    },
    transactionContainer: {
      padding: 16,
      borderRadius: 16,
      maxWidth: '75%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      right: isReceived ? 'auto' : 16,
      left: isReceived ? 16 : 'auto',
      width: 8,
      height: 8,
      backgroundColor: isReceived ? theme.greys[1200] : theme.shades[300],
      transform: [{ rotate: '45deg' }],
    },
    labelContainer: {
      backgroundColor: 'rgba(0,0,0,0.25)',
      padding: 4,
      paddingHorizontal: 8,
      marginBottom: 4,
      borderRadius: 16,
    },
    labelText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      textAlign: 'center',
      color: theme.greys[0],
    },
    transactionText: {
      fontFamily: 'OverpassHeavy',
      fontSize: 16,
      color: theme.greys[0],
      marginBottom: 8,
    },
    timestamp: {
      color: theme.greys[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      textAlign: 'right',
    },
  });

export default VpnComponent;
