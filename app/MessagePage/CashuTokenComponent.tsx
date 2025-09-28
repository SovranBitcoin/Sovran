import React from 'react';
import { StyleSheet, Pressable, ColorValue } from 'react-native';
import { View, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken } from '@cashu/cashu-ts';
import { greys, shades, Theme } from 'helper/colors';
import { Button } from 'components/ui/Button';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { receiveEcash } from 'helper/cashuClient';
import { showMessage } from 'helper/popup/popups';
import { useCashu } from 'helper/redux/cashu';
import { useTypedNavigation } from 'helper/navigation';
import opacity from 'hex-color-opacity';

interface Props {
  token: string;
  theme: Theme;
  isReceived: boolean;
}

const CashuTokenComponent = ({ token, theme, isReceived }: Props) => {
  const styles = createStyles(theme);
  const { transactions } = useCashu();
  const navigation = useTypedNavigation();

  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((a, p) => a + p.amount, 0);
  const unit = decoded.unit;

  const transaction = transactions.find((t) => t.token === token);
  const isClaimed = Boolean(transaction);

  const handleViewTransaction = () => {
    if (transaction) {
      navigation.navigate('transaction', {
        id: transaction.token || transaction.request || '',
        transactionType: transaction.transactionType,
      });
    }
  };

  const handleRedeem = async () => {
    if (!unit) {
      showMessage('No unit set', {}, { emoji: '🚨' });
      return;
    }

    const res = await receiveEcash({ token, unit });
    if (res.isOk()) {
      showMessage('funds_received', { amount, unit }, { emoji: '🎉' });
    } else {
      showMessage(res.error.message, {}, { emoji: '🚨' });
    }
  };

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [greys(theme)[500], greys(theme)[500]]
    : [shades[200], shades[300]];

  return (
    <View style={[styles.wrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View
        style={[
          styles.arrow,
          {
            backgroundColor: isReceived ? greys(theme)[500] : shades[300],
            left: isReceived ? 16 : 'auto',
            right: isReceived ? 'auto' : 16,
          },
        ]}
      />
      <Pressable onLongPress={handleViewTransaction}>
        <LinearGradient colors={gradientColors} style={styles.container}>
          <Text style={styles.mintText}>{decoded.mint}</Text>

          <HStack justify="space-between">
            <View>
              {unit && (
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={24}
                  weight="heavy"
                  color={greys(theme)[0]}
                />
              )}
              {decoded.memo && <Text style={styles.memoText}>{decoded.memo}</Text>}
            </View>
          </HStack>
          <Button
            text={isClaimed ? 'View Transaction' : 'Redeem'}
            variant="primary"
            onPress={isClaimed ? handleViewTransaction : handleRedeem}
          />
        </LinearGradient>
      </Pressable>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: 8,
      position: 'relative',
      width: '100%',
    },
    container: {
      padding: 16,
      borderRadius: 16,
      width: '100%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
    },
    memoText: {
      fontFamily: 'OverpassRegular',
      fontSize: 12,
      color: greys(theme)[0],
      backgroundColor: opacity(greys(theme)[0], 0.1),
      padding: 16,
      borderRadius: 8,
    },
    mintText: {
      fontFamily: 'OverpassBold',
      fontSize: 12,
      color: greys(theme)[0],
      opacity: 0.75,
    },
  });

export default CashuTokenComponent;
