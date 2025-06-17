import React, { useState } from 'react';
import { formatCurrency } from 'helper/currency';
import {
  getDescription,
  getExpiresIn,
  getExpiry,
  getTimestamp,
  sendLightning,
} from 'components/cashu';
import Modal from 'components/layout/Modal';
import { useSelector, useDispatch } from 'react-redux';
import { View } from 'components/common/Themed';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation/index';
import { handleBarcode } from 'helper/payment-handler/handlers';
import { setSelectedMint } from 'helper/redux/cashu/actions';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { truncateMiddle } from 'helper/strings';
import { useGetMintInfo, memoizedGetSelectedMint } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Card } from 'components/common/Card';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { MintDetailPage } from './ecashSendConfirmation';
import { BalanceUpdate } from 'components/common/BalanceUpdate';

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';

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
  const dispatch = useDispatch();

  const [meltQuote, setMeltQuote] = useState(initialMeltQuote);
  const [unit, setUnit] = useState(initialUnit);
  const [loading, setLoading] = useState(false);

  const parsedQuote = JSON.parse(meltQuote);
  const amount = parsedQuote?.amount;
  const feeReserve = parsedQuote?.fee_reserve;
  const quoteId = parsedQuote?.quote;

  const profileId = useSelector((state) => state.nostr?.currentProfile?.id);

  const theme = useSelector(memoizedGetTheme);
  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMintUrl });
  const handleMintSelected = async (mint, balance) => {
    try {
      dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));

      if (pr) {
        // Avoid UI bugs with setTimeout
        await new Promise((resolve) => setTimeout(resolve, 0));
        console.log(12087387, { pr });
        const result = await handleBarcode({
          scanning: { data: pr },
          selectedMint: mint.id,
          unit: mint.unit.toLowerCase(),
          setProgress: () => {},
          setLoading: () => {},
          setScanned: () => {},
          urDecoder: null,
        });

        console.log(1928739872378, { result });

        if (result?.params?.meltQuote) {
          setMeltQuote(result.params.meltQuote);
          setUnit(result.params.unit);
        }
      }
    } catch (error) {
      showMessage('general_error', {}, { emoji: '🚨' });

      throw error;
    }
  };

  const handleLightningSend = async () => {
    setLoading(true);
    try {
      await sendLightning({
        pr,
        unit,
        pubkey,
        meltQuote: parsedQuote,
        email,
        lud16,
      });

      showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, () => {
        navigation.navigate(
          redirect || (pubkey ? 'userMessages' : 'index'),
          { pubkey },
          { closeCurrentAndParents: true }
        );
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.log(e, errorMessage);
      showMessage(errorMessage, { error: errorMessage }, { emoji: '🚨' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigation.navigate('index', {}, { closeCurrentAndParents: true });
  };

  const getCurrencyDisplay = () => (unit === 'sat' ? 'BTC' : unit.toUpperCase());

  const formatAmount = (value, displayDenomination = unit === 'sat' ? 'btc' : unit) => {
    return formatCurrency(
      {
        currency: getCurrencyDisplay(),
        value: value,
        denomination: unit === 'sat' ? 'sats' : unit,
      },
      {
        locale: 'en-US',
        precision: displayDenomination === 'btc' ? 8 : 2,
        currencyDisplay: 'symbol',
        denomination: displayDenomination,
      }
    );
  };
  console.log(JSON.stringify(transaction, null, 2));

  return (
    <Modal
      showClose
      title="Send Lightning"
      children={
        <View style={{ backgroundColor: 'transparent' }}>
          <BalanceUpdate
            pubkey={pubkey}
            transactionType="send"
            amount={amount}
            unit={unit}
            request={pr}
            transaction={transaction}
          />
          {!transaction?.paid && (
            <SelectedMintDisplay
              onMintSelected={handleMintSelected}
              pr={pr}
              unit={unit}
              loading={loading}
            />
          )}

          {getDescription({ pr }) && (
            <View style={{ margin: 16, marginTop: 12, marginBottom: 0 }}>
              <Card message={getDescription({ pr })} variant="info" />
            </View>
          )}

          {transaction?.paid && (
            <MintDetailPage
              mintInfo={mintInfo}
              theme={theme}
              transactionType="send"
              transaction={transaction}
            />
          )}

          {/* <Section
            items={[
              {
                title: 'Expires at',
                value: getExpiry({ pr }),
              },
              {
                title: 'Expires in',
                value: getExpiresIn({ pr }),
              },
            ]}
          /> */}

          <Section
            items={[
              { title: 'Date', value: getTimestamp({ pr }) },
              { title: 'Type', value: 'Send • Lightning' },
              { title: 'Request', value: truncateMiddle(lud16 || pr, lud16 ? 10 : 5) },
              { title: 'Quote', value: truncateMiddle(quoteId, 7) },
              {
                title: `Fee (${getCurrencyDisplay()})`,
                value: formatAmount(feeReserve),
              },
            ]}
          />
        </View>
      }
      buttons={
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
            paddingBottom: 8,
          }}>
          <ButtonHandler
            buttons={
              transaction?.paid
                ? [
                    {
                      text: 'Close',
                      icon: 'ri:close-circle-line',
                      variant: 'secondary',
                      onPress: handleCancel,
                    },
                    ...(transaction.nostr.pubkey
                      ? [
                          {
                            text: 'View Message',
                            icon: 'ri:message-2-line',
                            variant: 'primary',
                            onPress: () => {
                              navigation.navigate('userMessages', {
                                pubkey: transaction.nostr.pubkey,
                              });
                              navigation.goBack();
                            },
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      text: 'Cancel',
                      icon: 'ri:close-circle-line',
                      variant: 'secondary',
                      onPress: handleCancel,
                    },
                    {
                      text: 'Send',
                      icon: 'ri:send-plane-2-fill',
                      variant: 'primary',
                      onPress: handleLightningSend,
                      loading: loading,
                    },
                    ...extraButtons,
                  ]
            }
          />
        </View>
      }
    />
  );
}

function ModalScreen() {
  const { pr, unit, pubkey, meltQuote, redirect, email, lud16 } =
    useTypedRoute<'lightningSendConfirmation'>();

  return (
    <LightningSendConfirmation
      pr={pr}
      unit={unit}
      pubkey={pubkey}
      meltQuote={meltQuote}
      redirect={redirect}
      email={email}
      lud16={lud16}
    />
  );
}

export default withSheetProvider(ModalScreen);
