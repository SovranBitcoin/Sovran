import { useNavigation } from 'expo-router';
import { StyleSheet } from 'react-native';
import Modal from 'components/layout/Modal';
import { StyledText, Text, View } from 'components/common/Themed';
import { convertTime } from 'helper/time';
import { formatCurrency } from 'helper/currency';
import { cancelEcashTransaction, getLightningAmount } from 'components/cashu';
import Icon, { FalseIcon, TrueIcon } from 'assets/icons';
import { useDispatch, useSelector } from 'react-redux'; // Import useDispatch from react-redux
import { useCashu } from 'helper/redux/cashu';
import { useNostr } from 'helper/redux/nostr';
import { store } from 'helper/redux/store';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { BlurView } from 'expo-blur';
import { useEsims } from 'helper/redux/esim';

import { AmountFormatter } from 'components/layout/PrimaryBalance';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import Snow from 'react-native-snow-bg';
import { getGiveaway } from './ecashReceiveConfirmation';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import React from 'react';
import { truncateMiddle } from 'helper/strings';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { Card } from 'components/common/Card';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

export function BalanceUpdate({
  topAmount,
  bottomAmount,
  transactionType,
  amount,
  unit,
  pubkey,
  request,
  transaction,
  percentageDone,
}) {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles, currentProfile } = useNostr();
  const profilePicture =
    search?.find((s) => s.pubkey === pubkey)?.profile?.picture ||
    profiles?.find((s) => s.pubkey === pubkey)?.picture ||
    search?.find((s) => s.pubkey === pubkey)?.profile?.image ||
    profiles?.find((s) => s.pubkey === pubkey)?.image ||
    search?.find((s) => s.pubkey === pubkey)?.profile?.picture;
  const { esims } = useEsims();

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        paddingLeft: 8,
        backgroundColor: 'transparent',
      }}>
      <View
        style={{
          backgroundColor: 'transparent',
        }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'transparent',
            alignItems: 'center',
          }}>
          {transactionType === 'send' ? (
            <Text
              size={32}
              weight="bold"
              style={{
                color: shades[300],
                marginRight: 6,
              }}>
              -
            </Text>
          ) : (
            transactionType === 'receive' && (
              <Text
                weight="bold"
                size={24}
                style={{
                  color: greens[300],
                  textShadowColor: opacity(greys(theme)[0], 0.5),
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 1,
                  marginRight: 6,
                }}>
                +
              </Text>
            )
          )}
          <Text
            weight="bold"
            size={32}
            style={{
              color: transactionType === 'send' ? shades[300] : greens[300],
              textShadowColor: opacity(greys(theme)[0], 0.5),
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 1,
              backgroundColor: 'transparent',
            }}>
            {topAmount ? (
              topAmount
            ) : (
              <AmountFormatter
                amount={amount}
                unit={unit}
                size={32}
                weight="heavy"
                color={transactionType === 'receive' ? greens[300] : shades[300]}
              />
            )}
          </Text>
        </View>
        <Text
          size={20}
          style={{
            color: greys(theme)[0],
            marginLeft: 18,
            backgroundColor: 'transparent',
          }}>
          {amount < 0 ? '-' : ''}
          {bottomAmount
            ? bottomAmount
            : formatCurrency(
                {
                  currency: unit === 'sat' ? 'BTC' : unit?.toUpperCase(),
                  value: Math.abs(amount),
                  denomination: unit === 'sat' ? 'sats' : unit,
                },
                {
                  locale: 'en-US',
                  precision: 2,
                  currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
                  denomination: unit === 'usd' ? 'sats' : 'usd',
                }
              )}
        </Text>
      </View>
      <View
        style={{
          padding: 16,
          backgroundColor: 'transparent',
          transform: [{ scale: 1.25 }],
        }}>
        {profilePicture ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                zIndex: 100,
                backgroundColor: greys(theme)[1800],
                borderRadius: 100,
                height: 16,
                width: 16,
                padding: 3,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}>
              {transactionType === 'receive' ? (
                <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} size={10} />
              ) : transaction?.isCancel ? (
                <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
              ) : (
                <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} size={10} />
              )}
            </View>
            <CachedImage
              style={{
                width: 28,
                height: 28,
                borderRadius: 1000,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}
              source={{
                uri: profilePicture,
              }}
            />
          </View>
        ) : transactionType === 'receive' ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} />
          </View>
        ) : esims
            .map((e) => e.request)
            .filter((a) => a)
            .includes(request) ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                zIndex: 100,
                backgroundColor: greys(theme)[1800],
                borderRadius: 100,
                height: 16,
                width: 16,
                padding: 3,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}>
              {transaction?.isCancel ? (
                <Icon name="mdi:cancel" color={greys(theme)[100]} />
              ) : (
                <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
              )}
            </View>
            <Icon name="fluent:sim-24-filled" color={greys(theme)[100]} />
          </View>
        ) : (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            {transaction?.isCancel ? (
              <Icon name="mdi:cancel" color={greys(theme)[100]} />
            ) : (
              <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// todo: add nostr receiver/sender info
const transactionConfig = {
  ecash: {
    send: [
      {
        keys: [
          {
            label: 'date',
            output: (tx, value) => {
              return convertTime(new Date(value));
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'type',
            output: (tx, value) => {
              return (
                capitalizeFirstLetter(tx.transactionType) + ' • ' + capitalizeFirstLetter(value)
              );
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'token',
            output: (tx, value) => {
              return value ? truncateMiddle(value, 5) : '';
            },
          },
        ],
      },
    ],
    receive: [
      {
        keys: [
          {
            label: 'To',
            output: (tx, value) => {
              return tx?.fromNIP05;
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'date',
            output: (tx, value) => {
              return convertTime(new Date(value));
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'type',
            output: (tx, value) => {
              return (
                capitalizeFirstLetter(tx.transactionType) + ' • ' + capitalizeFirstLetter(value)
              );
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'token',
            output: (tx, value) => {
              return value ? truncateMiddle(value, 5) : '';
            },
          },
        ],
      },
    ],
  },
  lightning: {
    send: [
      {
        keys: [
          {
            label: 'to',
            output: (tx, value) => {
              const profiles = store.getState().nostr?.profiles;
              const search = store.getState().nostr?.search;
              const profile =
                search?.find((s) => s.pubkey === tx.nostr.pubkey)?.profile ||
                profiles?.find((s) => s.pubkey === tx.nostr.pubkey);

              return profile?.displayName;
            },
          },
        ],
        title: '',
      },
      {
        keys: [
          {
            label: 'date',
            output: (tx, value) => {
              return convertTime(new Date(value));
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'type',
            output: (tx, value) => {
              return (
                capitalizeFirstLetter(tx.transactionType) + ' • ' + capitalizeFirstLetter(value)
              );
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'request',
            output: (tx, value) => {
              return truncateMiddle(value, 5);
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'Email',
            output: (tx, value) => {
              return tx.email;
            },
          },
        ],
      },
    ],
    receive: [
      {
        keys: [
          {
            label: 'date',
            output: (tx, value) => {
              return convertTime(new Date(value));
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'type',
            output: (tx, value) => {
              return (
                capitalizeFirstLetter(tx.transactionType) + ' • ' + capitalizeFirstLetter(value)
              );
            },
          },
        ],
      },
      {
        keys: [
          {
            label: 'request',
            output: (tx, value) => {
              return truncateMiddle(value, 5);
            },
          },
          {
            label: 'quote',
            output: (tx, value) => {
              return truncateMiddle(tx.mintQuote.quote, 5);
            },
          },
        ],
      },
    ],
  },
};

export function getSectionData(transaction, dispatch) {
  const config = transactionConfig?.[transaction?.type]?.[transaction?.transactionType] || [];
  return config.map((section) => {
    const items = section.keys.map((key) => {
      if (typeof key === 'string') {
        return {
          title: capitalizeFirstLetter(key),
          value: transaction[key] || 'N/A',
        };
      } else if (typeof key === 'object' && key.label && key.output) {
        return {
          title:
            typeof key.label === 'string'
              ? capitalizeFirstLetter(key.label)
              : key.label(transaction, key.label),
          value: key.output(transaction, transaction[key.label], dispatch) || 'N/A',
        };
      }
    });
    return { title: section.title, items };
  });
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const navigation = useNavigation();
  const { id, transactionType } = useTypedRoute<'modal'>();
  const { transactions: cashuTransactions } = useCashu();
  const dispatch = useDispatch();

  if (cashuTransactions.length === 0) {
    return (
      <View>
        <Text>No transactions</Text>
      </View>
    );
  }

  const transactions = cashuTransactions;

  if (!transactions) {
    return null;
  }

  const transaction = transactions.find(
    (t) =>
      t.txid === id ||
      String(t.id) === String(id) ||
      (t.request && t.request === id) ||
      (t.token && t.token === id && t.transactionType === transactionType)
  );

  const sections = getSectionData(transaction, dispatch);

  const handleCancelSend = async () => {
    await cancelEcashTransaction(transaction, navigation);
  };

  return (
    <Modal
      title=""
      showClose
      children={
        <View
          style={{
            backgroundColor: greys(theme)[2300],
          }}>
          {transaction.token &&
            getGiveaway({
              token: transaction.token,
            })?.id && <Snow fullScreen snowflakesCount={75} fallSpeed="medium" />}
          <BalanceUpdate
            transaction={transaction}
            transactionType={transaction.transactionType}
            amount={transaction.amount}
            unit={transaction.unit}
            pubkey={transaction?.nostr?.pubkey}
            request={transaction.request}
          />
          {/* <MapView
            style={{
              height: 100,
              margin: 16,
              borderRadius: 16,
            }}
            initialRegion={{
              latitude: 37.78825,
              longitude: -122.4324,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            }}
          /> */}
          {transaction.transactionType === 'send' &&
            transaction.type === 'ecash' &&
            !transaction.paid && (
              <View style={{ marginHorizontal: 16 }}>
                <Card
                  onPress={() => {
                    showMessage('pending_ecash_transaction', {}, { variant: 'modal' });
                  }}
                  variant="info"
                  message="Why is this transaction pending?"
                  theme={theme}
                  icon={
                    <Icon name="mdi:information-outline" size={24} color={greys(theme)[100]} />
                  }></Card>
              </View>
            )}
          {sections.map((section) => (
            <Section
              key={section.title}
              title={section.title}
              items={section.items}
              special={false}
            />
          ))}
        </View>
      }
      buttons={
        <View
          style={{
            backgroundColor: 'transparent',
          }}>
          <ButtonHandler
            context="transactionButtons"
            buttons={[
              transaction?.nostr?.pubkey
                ? {
                    text: 'View Chat',
                    onPress: () => {
                      navigation.goBack();
                      navigation.navigate('userMessages', {
                        pubkey: transaction.nostr.pubkey,
                      });
                    },
                  }
                : null,
              transaction.request &&
                !transaction.paid && {
                  text: 'Open Invoice',
                  onPress: () => {
                    navigation.navigate('lightningReceiveConfirmation', {
                      unit: transaction.unit,
                      request: transaction.request,
                      amount: transaction.amount,
                      transaction: JSON.stringify(transaction),
                      unifiedRequest: transaction.unifiedRequest,
                      paymentRequest: transaction.paymentRequest,
                    });
                  },
                },
              transaction.type === 'ecash' &&
                !transaction.paid &&
                transaction.transactionType === 'send' && {
                  text: 'Open Invoice',
                  onPress: () => {
                    navigation.navigate('ecashSendConfirmation', {
                      unit: transaction.unit,
                      token: transaction.token,
                      amount: transaction.amount,
                    });
                  },
                },
            ].filter(Boolean)} // Filter out any falsey values
          />
        </View>
      }
    />
  );
}

export default withSheetProvider(ModalScreen);

const createStyles = (theme) =>
  StyleSheet.create({
    minus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#9A4141',
      marginRight: 4,
    },
    plus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#499A41',
      marginRight: 4,
    },
    container: {
      backgroundColor: greys(theme)[2300],
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[1000],
    },
    separator: {
      marginVertical: 30,
      height: 1,
      width: '80%',
    },
  });
