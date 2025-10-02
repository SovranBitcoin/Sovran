import React, { useState } from 'react';
import { CurrencyCode, Denomination, formatCurrency } from 'helper/currency';
import { useCashuUtilities, useMintManagement } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { useSelector } from 'react-redux';
import { Spacer, View, VStack, HStack } from 'components/ui/View';

import { useTypedNavigation, useTypedRoute } from 'helper/navigation/index';
import { handleBarcode } from 'helper/payment-handler/handlers';
// Removed Redux Cashu actions - now using Coco
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { truncateMiddle } from 'helper/strings';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Card } from 'components/ui/Card';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';

import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
// Removed RootState import - no longer needed
import { SheetManager } from 'react-native-actions-sheet';

export function LightningSendConfirmation({
  transaction,
  pr,
  unit: initialUnit,
  pubkey,
  meltQuote: initialMeltQuote,
  redirect,
  email,
  extraButtons = [],
  lud16,
}: {
  transaction?: any;
  pr: string;
  unit: string;
  pubkey?: string;
  meltQuote?: string;
  redirect?: string;
  email?: string;
  extraButtons?: ButtonHandlerButton[];
  lud16?: string;
}) {
  const navigation = useTypedNavigation();
  const { getLightningDescription, getLightningTimestamp } = useCashuUtilities();

  const [meltQuote, setMeltQuote] = useState(initialMeltQuote);
  const [unit, setUnit] = useState(initialUnit);
  const parsedQuote = JSON.parse(meltQuote || '{}');
  const amount = parsedQuote?.amount;
  const feeReserve = parsedQuote?.fee_reserve;
  const quoteId = parsedQuote?.quote;

  // Removed profileId - no longer needed with Coco

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = React.useState<any>({});

  // Load mint info when selectedMintUrl changes
  React.useEffect(() => {
    const loadMintInfo = async () => {
      if (selectedMintUrl) {
        try {
          const info = await getMintInfo(selectedMintUrl);
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
  }, [selectedMintUrl, getMintInfo]);

  const handleMintSelected = async (mint: any, balance: any) => {
    if (pr) {
      // Avoid UI bugs with setTimeout
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = await handleBarcode({
        scanning: { data: pr },
        selectedMint: mint.id,
        unit: mint.unit.toLowerCase(),
        setProgress: () => {},
        setLoading: () => {},
        setScanned: () => {},
        balance: balance?.amount,
      });
      if (result.isOk() && result.value) {
        // Note: Mint selection now handled by Coco
        setMeltQuote(result.value.params.meltQuote);
        setUnit(result.value.params.unit);
      } else {
        throw new Error('mint_change_failed');
      }
    } else {
      // Note: Mint selection now handled by Coco
      setUnit(mint.unit.toLowerCase());
    }
  };

  const handleOpenSheet = () => {
    SheetManager.show('lightning-mpp', {
      payload: {
        pr,
        unit,
        amount,
        pubkey,
        email,
        lud16,
        redirect,
      },
    });
  };

  const handleCancel = () => {
    navigation.navigate('index', {}, { closeCurrentAndParents: true });
  };

  const getCurrencyDisplay = () => (unit === 'sat' ? 'BTC' : unit.toUpperCase());

  const formatAmount = (value: number, displayDenomination = unit === 'sat' ? 'btc' : unit) => {
    return formatCurrency(
      {
        currency: getCurrencyDisplay() as CurrencyCode,
        value: value,
        denomination: unit === 'sat' ? 'sats' : (unit as Denomination),
      },
      {
        locale: 'en-US',
        precision: displayDenomination === 'btc' ? 8 : 2,
        currencyDisplay: 'symbol',
        denomination: displayDenomination as Denomination,
      }
    );
  };

  return (
    <Modal
      showClose
      title="Send Lightning"
      buttons={
        <HStack className="pb-2" justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => handleCancel(),
                condition: !!transaction?.paid,
              },
              {
                text: 'View Message',
                icon: 'ri:message-2-line',
                variant: 'primary',
                onPress: async () => {
                  navigation.navigate('userMessages', {
                    pubkey: transaction.nostr.pubkey,
                  });
                  navigation.goBack();
                },
                condition: !!(transaction?.paid && transaction.nostr.pubkey),
              },
              {
                text: 'Cancel',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => handleCancel(),
                condition: !transaction?.paid,
              },
              {
                text: 'Send',
                icon: 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handleOpenSheet(),
                condition: !transaction?.paid,
              },
              ...extraButtons.map((button) => ({
                ...button,
                condition: !transaction?.paid,
              })),
            ]}
          />
        </HStack>
      }>
      <View>
        <TransactionHeader
          transaction={{
            ...transaction,
            isSend: true,
            unit,
            amount,
            transactionType: 'send',
            type: 'lightning',
            nostrPubkey: pubkey,
          }}
        />
        {!transaction?.paid && (
          <MintBalanceDisplay
            onMintSelected={handleMintSelected}
            unit={unit}
            updateSelectedMint={false}
          />
        )}
        <Spacer size={12} />

        {getLightningDescription(pr) && (
          <VStack spacing={12} style={{ margin: 16, marginTop: 12 }}>
            <Card message={getLightningDescription(pr)} variant="info" />
          </VStack>
        )}

        {transaction?.paid && (
          <TransactionMintRefresh
            mintInfo={mintInfo}
            transaction={{ ...transaction, transactionType: 'send' }}
          />
        )}
        <Spacer size={12} />

        <Section
          items={[
            { title: 'Date', value: getLightningTimestamp(pr) },
            { title: 'Type', value: 'Send • Lightning' },
            { title: 'Request', value: truncateMiddle(lud16 || pr, lud16 ? 10 : 5) },
            { title: 'Quote', value: truncateMiddle(quoteId, 7) },
            {
              title: `Fee (${getCurrencyDisplay()})`,
              value: formatAmount(feeReserve),
            },
          ]}
        />
        <Spacer size={12} />

        {transaction && <TransactionDebugCode transaction={transaction} />}
      </View>
    </Modal>
  );
}

function ModalScreen() {
  const { pr, unit, pubkey, meltQuote, redirect } = useTypedRoute<'lightningSendConfirmation'>();

  return (
    <LightningSendConfirmation
      pr={pr}
      unit={unit}
      pubkey={pubkey}
      meltQuote={meltQuote}
      redirect={redirect}
    />
  );
}

export default withSheetProvider(ModalScreen);
