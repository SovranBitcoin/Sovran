import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken } from '@cashu/cashu-ts';
import { greys, shades } from 'helper/colors';
import { Button } from 'components/common/Button';
import { cancelEcashTransaction, receiveEcash } from 'components/cashu';
import { showMessage } from 'helper/popup/popups';
import { useCashu } from 'helper/redux/cashu';
import { useTypedNavigation } from 'helper/navigation';
import { convertTime } from 'helper/time';
import opacity from 'hex-color-opacity';

interface Props {
  token: string;
  theme: string;
  isReceived: boolean;
  date?: string;
}

const EcashComponent = ({ token, theme, isReceived, date }: Props) => {
  const styles = createStyles(theme, isReceived);
  const { transactions } = useCashu();
  const navigation = useTypedNavigation();

  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((a, p) => a + p.amount, 0);
  const unit = decoded.unit;

  const sendTx = transactions.find(
    (t) => t.token === token && t.transactionType === 'send'
  );
  const receiveTx = transactions.find(
    (t) => t.token === token && t.transactionType === 'receive'
  );

  const isClaimed = isReceived ? Boolean(receiveTx) : Boolean(sendTx?.paid);

  const handleRedeem = async () => {
    try {
      await receiveEcash({ token, unit });
      showMessage('funds_received', { amount, unit }, { emoji: '🎉' });
    } catch (error) {
      showMessage(error.message, {}, { emoji: '🚨' });
    }
  };

  const handleCancel = async () => {
    if (!sendTx) return;
    try {
      await cancelEcashTransaction(sendTx, navigation);
    } catch (error) {
      showMessage(error.message, {}, { emoji: '🚨' });
    }
  };

  const gradientColors = isReceived
    ? [greys(theme)[1000], greys(theme)[1200]]
    : [shades[100], shades[300]];

  return (
    <View style={[styles.wrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View
        style={[
          styles.arrow,
          {
            backgroundColor: isReceived ? greys(theme)[1200] : shades[300],
            left: isReceived ? 16 : 'auto',
            right: isReceived ? 'auto' : 16,
          },
        ]}
      />
      <LinearGradient colors={gradientColors} style={styles.container}>
        <Text style={styles.mintText}>{decoded.mint}</Text>

        <View style={styles.footer}>
          <View>
            <Text style={styles.amountText}>
              {amount} {unit === 'sat' ? 'sats' : unit}
            </Text>
            {decoded.memo && <Text style={styles.memoText}>{decoded.memo}</Text>}
          </View>
        </View>
        <Button
          text={
            isClaimed
              ? 'Redeemed'
              : isReceived
              ? 'Redeem'
              : 'Cancel'
          }
          variant="primary"
          disabled={isClaimed}
          onPress={isReceived ? handleRedeem : handleCancel}
        />
        {date && <Text style={styles.timestamp}>{convertTime(new Date(date))}</Text>}
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme: string, isReceived: boolean) =>
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
      color: greys(theme)[0],
    },
    amountText: {
      fontFamily: 'OverpassHeavy',
      fontSize: 24,
      color: greys(theme)[0],
      marginBottom: 0,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
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
    timestamp: {
      color: greys(theme)[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      textAlign: 'right',
      marginTop: 8,
    },
  });

export default EcashComponent;
