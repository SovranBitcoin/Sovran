import React, { useState } from 'react';
import { useCashuOperations, useMintManagement } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { popup } from '@/helper/popup';
import { useLocalSearchParams, router } from 'expo-router';
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
import { VStack } from 'components/ui/View';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';

export function EcashReceiveConfirmation({
  receiveHistoryEntry,
  extraButtons = [],
}: {
  receiveHistoryEntry: ReceiveHistoryEntry & { token?: string };
  extraButtons?: ButtonHandlerButton[];
}) {
  const { receiveEcash } = useCashuOperations();
  const { isKnownMint } = useMintManagement();

  const token = receiveHistoryEntry?.token;

  const [loading, setLoading] = useState(false);

  const handleCancel = () => {
    router.back();
  };

  const handleRedeem = async () => {
    setLoading(true);
    try {
      await receiveEcash(token as string);
      popup({
        message: 'funds_received',
        params: { amount: receiveHistoryEntry.amount, unit: receiveHistoryEntry.unit },
        emoji: '🎉',
        onClose: () => {
          router.dismissAll();
          router.push('/(drawer)/(tabs)');
        },
      });
    } catch (error) {
      console.error(error);
      popup({
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    }
    setLoading(false);
  };

  const handleRedeemPress = async () => {
    const isMintTrusted = await isKnownMint(receiveHistoryEntry.mintUrl);
    if (isMintTrusted) {
      await handleRedeem();
    } else {
      SheetManager.show('mint-accepter', {
        payload: { mint: receiveHistoryEntry.mintUrl },
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
      if (receiveHistoryEntry.mintUrl) {
        try {
          const info = await getMintInfo(receiveHistoryEntry.mintUrl);
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
  }, [receiveHistoryEntry.mintUrl, getMintInfo]);

  return (
    <Modal
      title="Receive Ecash"
      childrenStyles={{}}
      showBack
      transparent={false}
      buttons={
        <ButtonHandler
          buttons={[
            // {
            //   text: 'View Send Transaction',
            //   variant: 'secondary',
            //   onPress: async () => {
            //     router.push({
            //       pathname: '/transaction',
            //       params: {
            //         id:
            //           ('request' in receiveHistoryEntry
            //             ? receiveHistoryEntry.request
            //             : undefined) ||
            //           ('token' in receiveHistoryEntry ? (receiveHistoryEntry as any).token : ''),
            //         transactionType: 'send',
            //       },
            //     });
            //   },
            //   condition: !!(
            //     receiveHistoryEntry.metadata?.isCancel && receiveHistoryEntry.type === 'receive'
            //   ),
            // },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => handleCancel(),
              condition: !('state' in receiveHistoryEntry && receiveHistoryEntry.state === 'PAID'),
            },
            {
              text: 'Redeem Ecash',
              variant: 'primary',
              onPress: handleRedeemPress,
              loading: loading,
              condition: !!token,
            },
            ...extraButtons,
          ]}
        />
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={receiveHistoryEntry} />

        {/* {memo && (
          <>
            <View
              style={{
                marginHorizontal: 16,
              }}>
              <Card message={memo} variant="info" />
            </View>
            <Spacer size={12} />
          </>
        )} */}

        <TransactionMintRefresh historyEntry={receiveHistoryEntry} mintInfo={mintInfo} />

        <Section
          items={[
            { title: 'Type', value: 'Ecash • Receive' },
            ...(token ? [{ title: 'Token', value: truncateMiddle(token, 6) }] : []),
          ]}
          camera={false}
        />

        <TransactionDebugCode historyEntry={receiveHistoryEntry} />
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { receiveHistoryEntry: receiveHistoryEntryString } = useLocalSearchParams<{
    receiveHistoryEntry: string;
  }>();

  const receiveHistoryEntry = JSON.parse(receiveHistoryEntryString) as ReceiveHistoryEntry & {
    token?: string;
  };

  return <EcashReceiveConfirmation receiveHistoryEntry={receiveHistoryEntry} />;
}

export default withSheetProvider(ModalScreen);
