import React, { useState } from 'react';
import { getDecodedToken } from '@cashu/cashu-ts';
import { useCashuOperations } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { useSelector } from 'react-redux';
import Snow from 'react-native-snow-bg';
import { showMessage } from 'helper/popup/popups';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { memoizedGetMints, TransactionBuilder } from 'helper/redux/cashu';
import { useMintManagement } from 'hooks/coco';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { truncateMiddle } from 'helper/strings';

// Main component
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { Spacer, View } from 'components/ui/View';
import { Card } from 'components/ui/Card';

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
    // Note: giveaways functionality removed with Coco migration
    // This would need to be reimplemented if needed
    return null;
  }

  return null;
};

function getTokenAmount({ token }: TokenProps): number {
  const decodedToken = getDecodedToken(token);
  return decodedToken.proofs.reduce((a, b) => a + b.amount, 0);
}

function getTokenMemo({ token }: TokenProps) {
  return getDecodedToken(token).memo;
}

function getTokenUnit({ token }: TokenProps) {
  return getDecodedToken(token).unit;
}

function getTokenMints({ token }: TokenProps) {
  return getDecodedToken(token).mint;
}

export function EcashReceiveConfirmation({
  token,
  transaction,
  extraButtons = [],
}: {
  token: string;
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
  const { receiveEcash } = useCashuOperations();
  const mints = useSelector(memoizedGetMints);

  const amount = getTokenAmount({ token });
  const memo = getTokenMemo({ token });
  const unit = getTokenUnit({ token });
  const giveaway = getGiveaway({ token });
  const mintUrl = getTokenMints({ token });
  const [loading, setLoading] = useState(false);

  const handleCancel = () => {
    navigation.goBack();
  };

  const handleRedeem = async () => {
    setLoading(true);
    try {
      await receiveEcash(token as string);
      showMessage('funds_received', { amount, unit }, { emoji: '🎉' }, () => {
        navigation.navigate('index', {}, { closeParents: true });
      });
    } catch (error) {
      console.error(error);
      showMessage(error instanceof Error ? error.message : 'Unknown error');
    }
    setLoading(false);
  };

  const handleRedeemPress = async () => {
    const isMintTrusted = mints?.includes(mintUrl);
    if (isMintTrusted) {
      await handleRedeem();
    } else {
      SheetManager.show('mint-accepter', {
        payload: { mint: mintUrl },
        onClose: async (result) => {
          if (result?.trusted) {
            await handleRedeem();
          }
        },
      });
    }
  };

  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = React.useState<any>({});

  // Load mint info when mintUrl changes
  React.useEffect(() => {
    const loadMintInfo = async () => {
      if (mintUrl) {
        try {
          const info = await getMintInfo(mintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      } else {
        setMintInfo({});
      }
    };
    loadMintInfo();
  }, [mintUrl, getMintInfo]);

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
              text: 'View Send Transaction',
              variant: 'secondary',
              onPress: async () => {
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
              condition: !!(transaction.isCancel && transaction.transactionType === 'receive'),
            },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => handleCancel(),
              condition: !transaction?.paid,
            },
            {
              text: 'Redeem Ecash',
              variant: 'primary',
              onPress: handleRedeemPress,
              loading: loading,
              condition: !transaction?.paid,
            },
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
  const { token } = useTypedRoute<'ecashReceiveConfirmation'>();

  return (
    <EcashReceiveConfirmation
      token={token}
      transaction={
        new TransactionBuilder({
          token,
          transactionType: 'receive',
          type: 'ecash',
        })
      }
    />
  );
}

export default withSheetProvider(ModalScreen);
