import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'components/common/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken } from '@cashu/cashu-ts';
import { Button } from 'components/common/Button';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { receiveEcash } from 'components/cashu';
import { showMessage } from 'helper/popup/popups';
import { useCashu } from 'helper/redux/cashu';
import { useTypedNavigation } from 'helper/navigation';
import opacity from 'hex-color-opacity';

interface Props {
  token: string;
  theme: any;
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
    try {
      await receiveEcash({ token, unit });
      showMessage('funds_received', { amount, unit }, { emoji: '🎉' });
    } catch (error) {
      showMessage(error.message, {}, { emoji: '🚨' });
    }
  };

  const gradientColors = isReceived
    ? [theme.greys[1000], theme.greys[1200]]
    : [theme.shades[100], theme.shades[300]];

  return (
    <View style={[styles.wrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View
        style={[
          styles.arrow,
          {
            backgroundColor: isReceived ? theme.greys[1200] : theme.shades[300],
            left: isReceived ? 16 : 'auto',
            right: isReceived ? 'auto' : 16,
          },
        ]}
      />
      <Pressable onLongPress={handleViewTransaction}>
        <LinearGradient colors={gradientColors} style={styles.container}>
          <Text style={styles.mintText}>{decoded.mint}</Text>

          <View style={styles.footer}>
            <View>
              <AmountFormatter
                amount={amount}
                unit={unit}
                size={24}
                weight="heavy"
                color={theme.greys[0]}
              />
              {decoded.memo && <Text style={styles.memoText}>{decoded.memo}</Text>}
            </View>
          </View>
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

const createStyles = (theme: any) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
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
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    memoText: {
      fontFamily: 'OverpassRegular',
      fontSize: 12,
      color: theme.greys[0],
      backgroundColor: opacity(theme.greys[0], 0.1),
      padding: 16,
      borderRadius: 8,
    },
    mintText: {
      fontFamily: 'OverpassBold',
      fontSize: 12,
      color: theme.greys[0],
      opacity: 0.75,
    },
  });

export default CashuTokenComponent;
