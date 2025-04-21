import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { StyledText, Text, View } from 'components/common/Themed';
import { formatCurrencyWrapper } from 'helper/currency';
import { BtcIcon, LightningUnit } from 'assets/icons';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { memoizedGetTotalBalance } from 'helper/redux/cashu';
import Haptics from 'components/common/Haptics';

export function PrimaryBalance({ account }) {
  const { settings, setDisplayBitcoin } = useSettings();
  const balance = useSelector(memoizedGetTotalBalance(account.unit));

  const toggleUnit = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDisplayBitcoin((settings.display_btc + 1) % 3);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        paddingTop: 0,
        zIndex: 9,
      }}>
      <TouchableOpacity
        onPress={toggleUnit}
        style={{ flexDirection: 'column', alignItems: 'center' }}>
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </View>
  );
}

export function AmountFormatter({ amount, unit, size = 37, weight = 'heavy', color }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { settings } = useSettings();
  const currentColor = color || greys(theme)[0];
  const displayBtc = settings.display_btc ?? 1;

  if (unit !== 'sat') {
    return (
      <View style={styles.container}>
        <Text size={size} weight={weight} style={[styles.primaryBalance, { color: currentColor }]}>
          {formatCurrencyWrapper(amount, unit, displayBtc)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {displayBtc === 0 && (
        <>
          <View style={{ marginLeft: weight === 'heavy' ? -7 : -4 }}>
            <BtcIcon weight={weight} height={size} width={size * 1.4} color={currentColor} />
          </View>
          <Text
            size={size}
            weight={weight}
            style={[
              styles.primaryBalance,
              { color: currentColor, marginLeft: weight === 'heavy' ? -7 : -4 },
            ]}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </>
      )}

      {displayBtc === 1 && (
        <>
          <StyledText
            size={size}
            weight={weight}
            style={[styles.primaryBalance, { color: currentColor }]}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </StyledText>
          <View style={styles.lightningContainer}>
            <LightningUnit height={size} width={size} color={currentColor} />
          </View>
        </>
      )}

      {displayBtc === 2 && (
        <Text size={size} weight={weight} style={[styles.primaryBalance, { color: currentColor }]}>
          {formatCurrencyWrapper(amount, unit, displayBtc)}
        </Text>
      )}
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    lightningContainer: {
      marginBottom: 4,
      backgroundColor: 'transparent',
    },
    primaryBalance: {
      color: greys(theme)[0],
      margin: 0,
      zIndex: 2,
    },
  });
