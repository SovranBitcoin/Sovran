import React, { useState } from 'react';
import { formatCurrency } from 'helper/currency';
import {
  getDescription,
  getExpiresIn,
  getExpiry,
  getTimestamp,
  sendLightning,
} from 'components/cashu';
import { BalanceUpdate, Section } from './transaction';
import Modal from 'components/layout/Modal';
import withConfirmation from 'components/layout/ConfirmationProvider';
import { useSelector, useDispatch } from 'react-redux';
import { View } from 'components/common/Themed';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation/index';
import { handleBarcode } from 'helper/payment-handler/handlers';
import { setSelectedMint } from 'helper/redux/cashu/actions';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { truncateMiddle } from 'helper/strings';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from './ecashSendConfirmation';

function ModalScreen() {
  const navigation = useTypedNavigation();
  const dispatch = useDispatch();
  const {
    pr,
    unit: initialUnit,
    pubkey,
    meltQuote: initialMeltQuote,
    redirect,
  } = useTypedRoute<'lightningSendConfirmation'>();

  const [meltQuote, setMeltQuote] = useState(initialMeltQuote);
  const [unit, setUnit] = useState(initialUnit);
  const [loading, setLoading] = useState(false);

  const parsedQuote = JSON.parse(meltQuote);
  const amount = parsedQuote?.amount;
  const feeReserve = parsedQuote?.fee_reserve;
  const quoteId = parsedQuote?.quote;

  const profileId = useSelector((state) => state.nostr?.currentProfile?.id);

  const handleMintSelected = async (mint, balance) => {
    console.log(129873897, { mint }, { balance });
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
      });

      showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, () => {
        navigation.navigate(
          redirect || (pubkey ? 'userMessages' : 'index'),
          { pubkey },
          { closeParents: true }
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
    navigation.goBack();
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

  return (
    <Modal
      showClose
      title="Send Lightning"
      children={
        <View style={{ backgroundColor: 'transparent' }}>
          <BalanceUpdate
            pubkey={pubkey}
            transactionType="send"
            topAmount={formatCurrency(
              {
                currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
                value: amount,
                denomination: unit === 'sat' ? 'sats' : unit,
              },
              {
                locale: 'en-US',
                precision: unit === 'sat' ? 8 : 2,
                currencyDisplay: 'symbol',
                denomination: unit === 'sat' ? 'btc' : unit,
              }
            )}
            bottomAmount={formatAmount(amount, 'usd')}
            amount={amount}
            unit={unit}
            request={pr}
          />

          <SelectedMintDisplay
            onMintSelected={handleMintSelected}
            pr={pr}
            unit={unit}
            loading={loading}
          />

          <Section
            items={[
              {
                title: 'Note',
                value: getDescription({ pr }),
              },
            ]}
          />

          <Section
            items={[
              {
                title: `Amount (${unit === 'sat' ? 'BTC' : unit.toUpperCase()})`,
                value: formatCurrency(
                  {
                    currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
                    value: amount,
                    denomination: unit === 'sat' ? 'sats' : unit,
                  },
                  {
                    locale: 'en-US',
                    precision: unit === 'sat' ? 8 : 2,
                    currencyDisplay: 'symbol',
                    denomination: unit === 'sat' ? 'btc' : unit,
                  }
                ),
              },
              {
                title: 'Amount (USD)',
                value: '≈' + formatAmount(amount, 'usd'),
              },
            ]}
          />

          <Section
            items={[
              {
                title: `Fee (${getCurrencyDisplay()})`,
                value: formatAmount(feeReserve),
              },
              {
                title: 'Fee (USD)',
                value: '≈' + formatAmount(feeReserve, 'usd'),
              },
            ]}
          />

          <Section
            items={[
              {
                title: 'Created at',
                value: getTimestamp({ pr }),
              },
              {
                title: 'Expires at',
                value: getExpiry({ pr }),
              },
              {
                title: 'Expires in',
                value: getExpiresIn({ pr }),
              },
            ]}
          />

          <Section
            items={[
              {
                title: 'Type',
                value: 'Lightning',
              },
              {
                title: 'Transaction Type',
                value: 'Send',
              },
            ]}
          />

          <Section
            special={false}
            items={[
              {
                title: 'Request',
                value: truncateMiddle(pr, 5),
              },
              {
                title: 'Quote',
                value: truncateMiddle(quoteId, 7),
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
            buttons={[
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
            ]}
          />
        </View>
      }
    />
  );
}

export default withConfirmation(ModalScreen);
