import React, { useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/layout/Modal';
import { Spinner } from 'components/common/Spinner';
import { SheetManager } from 'react-native-actions-sheet';
import { View, Spacer } from 'components/common/View';
import { Text } from 'components/common/Text';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import {
  getDecodedToken,
  getEncodedTokenV4,
  decodePaymentRequest,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { sendGiftWrappedEncryptedDirectMessage } from 'helper/nostrClient';
import _, { capitalize } from 'lodash';
import {
  memoizedGetTransactionByMatcher,
  memoizedGetTransactions,
  updateTransaction,
  useGetMintInfo,
} from 'helper/redux/cashu';
import { cancelEcashTransaction, getWallet } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { write } from 'components/common/useNfc';
import { useAutoListenBatch } from 'components/providers/TransactionsProvider';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/common/Card';

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { MintQuoteTimeline } from './lightningReceiveConfirmation';
import { TransactionMintRefresh } from 'components/common/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/common/Transaction/TransactionDebugCode';

export function EcashSendConfirmation({
  unit,
  amount,
  token,
  paymentRequest,
  extraButtons = [],
}: {
  unit: string;
  amount: number;
  token: string;
  paymentRequest?: string;
  extraButtons?: ButtonHandlerButton[];
}) {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const [uri, setUri] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [sendingNostr, setSendingNostr] = useState(false);

  const currentProfile = useSelector(memoizedGetCurrentProfile);

  const getCurrentTransaction = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) =>
        _.filter(txs, {
          token,
          unit,
          amount,
          transactionType: 'send',
        }),
    })
  );

  const resolvedPaymentRequest = paymentRequest || getCurrentTransaction[0]?.paymentRequest;

  const handleNFCSend = async () => {
    await write(token);
  };

  const handleCopy = async (onClose) => {
    await Clipboard.setStringAsync(token);
    showSuccess('ecash_token_copied', {}, {}, onClose);
  };

  const handleShare = async (onClose) => {
    await Share.share({
      url: uri,
      message: 'cashu://' + token,
    });
    onClose();
  };

  const handleSendNostr = async () => {
    const request = resolvedPaymentRequest;
    if (!request) return;
    try {
      setSendingNostr(true);
      const decoded = decodePaymentRequest(request);
      const receiverTarget = decoded.getTransport(PaymentRequestTransportType.NOSTR).target;
      const { data } = nip19.decode(receiverTarget);
      const { pubkey } = data as { pubkey: string };

      const decodedToken = getDecodedToken(token);

      const publishResult = await sendGiftWrappedEncryptedDirectMessage({
        message: JSON.stringify({
          mint: decodedToken.mint,
          unit: decodedToken.unit,
          proofs: decodedToken.proofs,
          id: decoded.id,
        }),
        recipient: pubkey,
        nsec: currentProfile.nsec,
      });
      if (publishResult.isErr()) {
        console.error('Failed to send encrypted direct message:', publishResult.error);
      }
    } finally {
      setSendingNostr(false);
    }
  };

  const handleCancelSend = async (onClose) => {
    const profileId = store.getState().nostr?.currentProfile?.id;
    const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

    const transaction = transactions.find(
      (t) => t.token === token && t.transactionType === 'send'
    );

    const res = await cancelEcashTransaction(transaction, navigation);
    if (res.isErr()) {
      showMessage(res.error.message, {}, {}, onClose);
    }
  };

  const formattedToken = getEncodedTokenV4(getDecodedToken(token)) || token;
  const isLongToken = formattedToken.length >= 500;

  const { isListening } = useAutoListenBatch(getCurrentTransaction);

  const checkProofsSpent = async (token: string): Promise<Result<boolean, Error>> => {
    const decodedToken = getDecodedToken(token);
    const { unit, mint: mintUrl, proofs } = decodedToken;

    const walletRes = await getWallet({
      unit,
      mintUrl,
      profile: null,
    });
    if (walletRes.isErr()) return err(walletRes.error);
    const wallet = walletRes.value;

    const spentRes = await toResult(wallet.checkProofsStates(proofs));
    if (spentRes.isErr()) return err(spentRes.error);

    if (spentRes.value.some((p) => p.state === 'SPENT')) {
      const profileId = store.getState().nostr?.currentProfile?.id;
      await store.dispatch(
        updateTransaction({
          profileId,
          matcher: (tx) => tx.token === token,
          updateFn: (tx) => ({
            ...tx,
            paid: true,
          }),
        })
      );
      return ok(true);
    }

    return ok(false);
  };

  const handleCheckStatus = async (onClose) => {
    if (isCheckingStatus) return;

    setIsCheckingStatus(true);
    const result = await checkProofsSpent(token);

    if (result.isOk()) {
      const proofsSpent = result.value;
      if (proofsSpent) {
        const decodedToken = getDecodedToken(token);
        const amount = _.sumBy(decodedToken.proofs, 'amount');

        showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, () => {
          navigation.navigate(
            'index',
            {},
            {
              closeParents: true,
            }
          );
          onClose();
        });
      } else {
        showMessage('ecash_transaction_pending', {}, { emoji: '❌' }, onClose);
      }
    } else {
      showMessage('error_checking_status', { error: result.error.message }, { emoji: '⚠️' }, onClose);
    }
    setIsCheckingStatus(false);
  };

  const handleCopyEmoji = async (onClose) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token,
      },
      onClose,
    });
  };
  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });
  return (
    <Modal
      showClose
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
              getCurrentTransaction[0].paid
                ? [
                    {
                      text: 'Close',
                      icon: 'ri:close-circle-line',
                      variant: 'secondary',
                      onPress: () => navigation.goBack(),
                    },
                    ...(getCurrentTransaction[0].nostr?.pubkey
                      ? [
                          {
                            text: 'View Messages',
                            icon: 'mdi:message-reply',
                            variant: 'primary',
                            onPress: () => {
                              navigation.navigate('userMessages', {
                                pubkey: getCurrentTransaction[0].nostr.pubkey,
                              });
                              navigation.goBack();
                            },
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      text: 'Copy',
                      icon: 'lets-icons:copy',
                      variant: 'primary',
                      onPress: handleCopy,
                    },
                    {
                      text: 'Share',
                      icon: 'ri:share-fill',
                      variant: 'secondary',
                      onPress: handleShare,
                    },
                    {
                      text: 'NFC',
                      icon: 'ph:contactless-payment-fill',
                      variant: 'secondary',
                      onPress: handleNFCSend,
                    },
                    ...(resolvedPaymentRequest
                      ? [
                          {
                            text: 'Send via Nostr',
                            icon: 'mdi:send',
                            variant: 'primary',
                            loading: sendingNostr,
                            onPress: handleSendNostr,
                          },
                        ]
                      : []),
                    // {
                    //   text: 'Check Status',
                    //   icon: 'humbleicons:refresh',
                    //   variant: 'secondary',
                    //   onPress: handleCheckStatus,
                    // },
                    {
                      text: 'Copy as Emoji',
                      icon: 'fluent:emoji-24-filled',
                      variant: 'primary',
                      onPress: handleCopyEmoji,
                    },
                    {
                      text: 'Cancel Transaction',
                      icon: 'mdi:cancel',
                      variant: 'dangerous',
                      onPress: handleCancelSend,
                    },
                    ...extraButtons,
                  ]
            }
          />
        </View>
      }>
      <TransactionHeader
        transaction={{ ...getCurrentTransaction[0], unit, amount, transactionType: 'send' }}
      />
      {!getCurrentTransaction[0].paid && (
        <PaymentInfo
          setUri={setUri}
          popupMessage="ecash_token_copied"
          unit={unit}
          data={formattedToken}
          animated={isLongToken}
          showSection={false}
        />
      )}
      <Spacer size={12} />
      {getCurrentTransaction[0].memo && (
        <>
          <View
            style={{
              marginHorizontal: 16,
            }}>
            <Card message={getCurrentTransaction[0].memo} variant="info" />
          </View>
          <Spacer size={12} />
        </>
      )}
      <TransactionMintRefresh
        transaction={{
          ...getCurrentTransaction[0],
          unit,
          amount,
          transactionType: 'send',
        }}
        mintInfo={mintInfo}
        handleCheckStatus={handleCheckStatus}
      />
      <Spacer size={12} />

      <MintQuoteTimeline
        transaction={{
          ...getCurrentTransaction[0],
          unit,
          amount,
          transactionType: 'send',
        }}
        meltQuotes={getCurrentTransaction[0].proofStates}
      />
      <Spacer size={12} />
      <Section
        items={[
          {
            title: 'Date',
            value: convertTime(new Date(getCurrentTransaction[0]?.date)),
          },
          {
            title: 'Type',
            value:
              capitalize(String(getCurrentTransaction[0]?.type)) +
              ' • ' +
              capitalize(String(getCurrentTransaction[0]?.transactionType)),
          },
          {
            title: 'Status',
            value: (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={{
                    color: greys(theme)[0],
                    fontFamily: 'OverpassBold',
                    fontSize: 16,
                  }}>
                  {getCurrentTransaction[0].paid ? 'Completed' : 'Pending'}
                </Text>
                {isListening && <Spinner style={{ marginLeft: 4 }} size={12} />}
              </View>
            ),
          },
          {
            title: 'Token',
            value: truncateMiddle(token, 6),
          },
        ]}
      />
      <Spacer size={12} />
      <TransactionDebugCode transaction={getCurrentTransaction[0]} />
    </Modal>
  );
}

function ModalScreen() {
  const { unit, amount, token, paymentRequest } = useTypedRoute<'ecashSendConfirmation'>();
  return (
    <EcashSendConfirmation
      unit={unit}
      amount={amount}
      token={token}
      paymentRequest={paymentRequest}
    />
  );
}

export default withSheetProvider(ModalScreen);
