import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { formatCurrency } from 'helper/currency';
import { getDecodedToken } from '@cashu/cashu-ts';
import { receiveEcash } from 'components/cashu';
import { BalanceUpdate } from './transaction';
import Modal from 'components/layout/Modal';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { schnorr } from '@noble/curves/secp256k1';
import Snow from 'react-native-snow-bg';
import { showMessage } from 'helper/popup/popups';
import { giveaways } from 'helper/cashu/secrets';
import { useRoute } from '@react-navigation/native';
import { useTypedNavigation } from 'helper/navigation';
import { memoizedGetMints } from 'helper/redux/cashu';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

// Types
interface TokenProps {
  token: string;
}

// Token utility functions
export const getGiveaway = ({ token }: TokenProps) => {
  const pubkeys = new Set<string>();
  const proofs = getDecodedToken(token).proofs;

  proofs.forEach(({ secret }) => {
    let parsed;
    try {
      parsed = JSON.parse(secret);
    } catch (e) {
      // If parsing fails, assume it's a hex string
      parsed = secret;
    }

    if (Array.isArray(parsed)) {
      if (parsed[0] === 'P2PK') {
        pubkeys.add(parsed[1].data as string);
      } else {
        throw new Error('Unsupported well-known secret');
      }
    }
  });

  if (pubkeys.size > 1) {
    throw new Error(
      'Received a token with multiple pubkeys. This is not supported yet. Please report this.'
    );
  }

  if (pubkeys.size === 1) {
    return Object.values(giveaways).find((p) => p.public_key === Array.from(pubkeys)[0]);
  }

  return null;
};

function getTokenAmount({ token }: TokenProps): number {
  const decodedToken = getDecodedToken(token);
  return decodedToken.proofs.reduce((a, b) => a + b.amount, 0);
}

function getTokenMemo({ token }: TokenProps): string {
  return getDecodedToken(token).memo;
}

function getTokenUnit({ token }: TokenProps): string {
  return getDecodedToken(token).unit;
}

function getTokenMints({ token }: TokenProps): string {
  return getDecodedToken(token).mint;
}

// Crypto utilities
const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
};

export const generatePublicKey = (hexPrivateKey: string): string => {
  if (hexPrivateKey.length !== 64) {
    throw new Error('Private key must be 32 bytes (64 hex characters)');
  }

  const privateKeyBytes = hexToBytes(hexPrivateKey);
  const publicKeyBytes = schnorr.getPublicKey(privateKeyBytes);
  return Buffer.from(publicKeyBytes).toString('hex');
};

// Main component
function ModalScreen({
  showConfirmation,
}: {
  showConfirmation: (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel: () => void
  ) => void;
}) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const mints = useSelector(memoizedGetMints);

  const {
    params: { token },
  } = useRoute() as { params: { token: string; unit: string } };

  const amount = getTokenAmount({ token });
  const memo = getTokenMemo({ token });
  const unit = getTokenUnit({ token });
  const giveaway = getGiveaway({ token });
  const mintUrl = getTokenMints({ token });
  const [loading, setLoading] = useState(false);

  const handleCancel = () => {
    navigation.navigate('Tabs', { screen: 'index' });
  };

  const handleRedeem = async () => {
    try {
      setLoading(true);
      await receiveEcash({
        token: token as string,
        unit: unit as string,
      });

      showMessage('funds_received', { amount, unit }, { emoji: '🎉' }, () => {
        navigation.navigate('index', {}, { closeParents: true });
      });

      setLoading(false);
    } catch (error) {
      showMessage(error.message);
    }
  };

  const handleRedeemPress = async () => {
    const isMintTrusted = mints?.includes(mintUrl);
    if (isMintTrusted) {
      await handleRedeem();
    } else {
      SheetManager.show('mint-accepter', {
        payload: { mint: mintUrl },
        onClose: async ({ trusted }) => {
          if (trusted) {
            await handleRedeem();
          }
        },
      });
    }
  };

  const renderFormattedAmount = (currency, showApprox = false) => {
    return `${showApprox ? '≈' : ''}${formatCurrency(
      {
        currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
        value: amount,
        denomination: unit === 'sat' ? 'sats' : unit,
      },
      {
        locale: 'en-US',
        precision: currency === 'BTC' ? 8 : 2,
        currencyDisplay: 'symbol',
        denomination: currency.toLowerCase(),
      }
    )}`;
  };

  return (
    <Modal
      title="Receive Ecash"
      childrenStyles={{}}
      showBack
      transparent={false}
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              icon: null,
              variant: 'secondary',
              onPress: handleCancel,
            },
            {
              text: 'Redeem Ecash',
              icon: null,
              variant: 'primary',
              onPress: handleRedeemPress,
              loading: loading,
            },
          ]}
        />
      }>
      <>
        {giveaway?.id && <Snow fullScreen snowflakesCount={75} fallSpeed="medium" />}

        <BalanceUpdate
          transactionType="receive"
          amount={amount}
          unit={unit}
          bottomAmount={unit !== 'sat' ? <></> : null}
          topAmount={null}
          pubkey={''}
          request=""
        />

        {memo && <Section items={[{ title: 'Note', value: memo }]} style={{}} camera={false} />}

        <Section
          items={[
            {
              title: `Amount (${unit === 'sat' ? 'BTC' : unit.toUpperCase()})`,
              value: renderFormattedAmount(unit === 'sat' ? 'BTC' : unit.toUpperCase()),
            },
            {
              title: 'Amount (USD)',
              value: renderFormattedAmount('usd', true),
            },
            {
              title: 'Mints',
              value: mintUrl,
            },
          ]}
          style={{}}
          camera={false}
        />

        <Section items={[{ title: 'Date', value: 'Now' }]} style={{}} camera={false} />

        <Section
          items={[
            { title: 'Type', value: 'Ecash' },
            { title: 'Transaction Type', value: 'Receive' },
          ]}
          style={{}}
          camera={false}
        />
      </>
    </Modal>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    label: {
      fontSize: 20,
      fontFamily: 'OverpassHeavy',
      color: greys(theme)[0],
      marginLeft: 16,
      textAlign: 'center',
    },
    description: {
      fontSize: 14,
      fontFamily: 'OverpassRegular',
      color: greys(theme)[100],
      marginLeft: 16,
      marginBottom: 8,
      marginTop: 8,
      textAlign: 'center',
    },
    link: {
      fontFamily: 'OverpassHeavy',
      fontSize: 20,
      marginBottom: -3,
    },
  });

export default withSheetProvider(ModalScreen);
