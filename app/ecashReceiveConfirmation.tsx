import React, { useState } from 'react';
import { getDecodedToken } from '@cashu/cashu-ts';
import { receiveEcash } from 'components/cashu';
import Modal from 'components/layout/Modal';
import { useSelector } from 'react-redux';
import { schnorr } from '@noble/curves/secp256k1';
import Snow from 'react-native-snow-bg';
import { showMessage } from 'helper/popup/popups';
import { giveaways } from 'helper/cashu/secrets';
import { useRoute } from '@react-navigation/native';
import { useTypedNavigation } from 'helper/navigation';
import { memoizedGetMints, useGetMintInfo } from 'helper/redux/cashu';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';
import { truncateMiddle } from 'helper/strings';

// Main component
import type { ButtonHandlerButton } from 'components/common/ButtonHandler';
import { TransactionMintRefresh } from 'components/common/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/common/Transaction/TransactionDebugCode';
import { Spacer, View } from 'components/common/View';
import { Card } from 'components/common/Card';

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
    } catch {
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

export function EcashReceiveConfirmation({
  token,
  transaction,
  extraButtons = [],
}: {
  token?: string;
  transaction: any;
  showConfirmation?: (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel: () => void
  ) => void;
  extraButtons?: ButtonHandlerButton[];
}) {
  const navigation = useTypedNavigation();
  const mints = useSelector(memoizedGetMints);

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

  const mintInfo = useGetMintInfo({ mintUrl });

  return (
    <Modal
      title="Receive Ecash"
      childrenStyles={{}}
      showBack
      transparent={false}
      buttons={
        <ButtonHandler
          buttons={[
            ...(transaction.isCancel && transaction.transactionType === 'receive'
              ? [
                  {
                    text: 'View Send Transaction',
                    icon: null,
                    variant: 'secondary',
                    onPress: () => {
                      navigation.navigate(
                        'transaction',
                        {
                          id: transaction.request || transaction.token,
                          transactionType: 'send',
                        },
                        {
                          closeCurrentAndParents: true,
                        }
                      );
                    },
                  },
                ]
              : []),

            ...(!transaction?.paid
              ? [
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
                ]
              : []),
            ...extraButtons,
          ]}
        />
      }>
      <>
        {giveaway?.id && <Snow fullScreen snowflakesCount={75} fallSpeed="medium" />}

        <TransactionHeader
          transaction={{
            ...transaction,
            amount,
            unit,
            transactionType: 'receive',
          }}
        />

        {memo && (
          <>
            <View
              style={{
                marginHorizontal: 16,
              }}>
              <Card message={memo} variant="info" />
            </View>
            <Spacer size={12} />
          </>
        )}

        <TransactionMintRefresh
          transaction={{ ...transaction, transactionType: 'receive' }}
          mintInfo={mintInfo}
        />
        <Spacer size={12} />

        <Section
          items={[
            // { title: 'Date', value: 'Now' },
            { title: 'Type', value: 'Ecash • Receive' },
            { title: 'Token', value: truncateMiddle(token, 6) },
          ]}
          style={{}}
          camera={false}
        />

        <Spacer size={12} />

        <TransactionDebugCode transaction={transaction} />
      </>
    </Modal>
  );
}

function ModalScreen() {
  const {
    params: { token },
  } = useRoute() as { params: { token: string } };

  return <EcashReceiveConfirmation token={token} />;
}

export default withSheetProvider(ModalScreen);
