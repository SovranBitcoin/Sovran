import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'components/common/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { greys } from 'helper/colors';

const EsimComponent = ({ esim, theme, isReceived }) => {
  const styles = createStyles(theme);
  const gradientColors = isReceived
    ? [theme.greys[1000], theme.greys[1200]]
    : [theme.shades[100], theme.shades[300]];
  const arrowStyle = isReceived ? [styles.arrow, styles.receiveArrow] : styles.arrow;
  const containerStyle = [styles.transactionContainer, isReceived && styles.receivedContainer];

  return (
    <View
      style={[styles.transactionWrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View style={arrowStyle} />
      <LinearGradient colors={gradientColors} style={containerStyle}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerText}>You received an eSIM</Text>
        </View>
        <Text style={styles.transactionText}>{esim.package?.name.replace('Days', ' days')}</Text>
        <Text style={styles.timestamp}>
          {convertTime(new Date(esim.order.packageList[0].createTime))}
        </Text>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    transactionWrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
    },
    transactionContainer: {
      padding: 16,
      borderRadius: 16,
      maxWidth: '75%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      right: 16,
      width: 8,
      height: 8,
      backgroundColor: theme.shades[300],
      transform: [{ rotate: '45deg' }],
    },
    receiveArrow: {
      left: 16,
      right: 'auto',
      backgroundColor: theme.greys[1200],
    },
    headerContainer: {
      backgroundColor: 'rgba(0,0,0,0.25)',
      padding: 4,
      marginBottom: 4,
      borderRadius: 16,
    },
    headerText: {
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
    receivedContainer: {
      alignSelf: 'flex-start',
    },
    timestamp: {
      color: theme.greys[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      textAlign: 'right',
    },
  });

export default EsimComponent;
