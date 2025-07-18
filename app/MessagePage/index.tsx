import { useState } from 'react';
import { StyleSheet, Alert, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSelector } from 'react-redux';
import { useActionSheet } from '@expo/react-native-action-sheet';
import moment from 'moment';

// Custom hooks
import { memoizedMessagesByProfile, Message, useNostr } from 'helper/redux/nostr';
import { TransactionBuilder, useCashu } from 'helper/redux/cashu';
import { Esim, useEsims } from 'helper/redux/esim';
import { useVpn, Vpn } from 'helper/redux/lnvpn';
import { BitrefillEvent, useBitrefill } from 'helper/redux/bitrefill';
import { memoizedGetTheme } from 'helper/redux/settings';

// Components
import Modal from 'components/layout/Modal';
import { greys, Theme } from 'helper/colors';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import Footer from './Footer';
import Header from './Header';
import TimelineItem from './TimeLine';
import { Button } from 'components/common/Button';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { SheetManager } from 'react-native-actions-sheet';
import { convertNpub } from 'app/(drawer)/(tabs)/payments';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { sendEncryptedDirectMessage } from 'helper/nostrClient';

export type TimelineItemType = BitrefillEvent | Vpn | Esim | Message | TransactionBuilder;

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const params = useTypedRoute<'userMessages'>();

  const navigation = useTypedNavigation<'currency'>();
  const { profiles, search, addMessage, currentProfile } = useNostr();
  const messages = useSelector(memoizedMessagesByProfile());
  const { transactions } = useCashu();
  const { esims } = useEsims();
  const { vpn } = useVpn();
  const { events } = useBitrefill();
  const { showActionSheetWithOptions } = useActionSheet();

  const [message, setMessage] = useState('');

  // Combine profiles and search results
  const combinedSearchAndProfiles = [
    ...search.map((s) => ({ pubkey: convertNpub(s.pubkey), ...s.profile })),
  ];

  // Filter and organize transactions
  const filteredTransactions = transactions.filter((t) => t?.nostr?.pubkey);

  // Group transactions by pubkey
  const groupedTransactions: Record<
    string,
    { pubkey: string; transactions: TransactionBuilder[] }
  > = filteredTransactions.reduce<
    Record<string, { pubkey: string; transactions: TransactionBuilder[] }>
  >((acc, transaction) => {
    const pubkey = convertNpub(transaction.nostr.pubkey);
    if (!acc[pubkey]) {
      acc[pubkey] = { pubkey, transactions: [] };
    }
    acc[pubkey].transactions.push(transaction);
    return acc;
  }, {});

  const enrichedTransactions = Object.values(groupedTransactions).map((group) => {
    const profile = combinedSearchAndProfiles.find((p) => convertNpub(p.pubkey) === group.pubkey);
    return {
      pubkey: convertNpub(group.pubkey),
      profile: profile || null,
      transactions: group.transactions,
    };
  });

  const currentTransactions = enrichedTransactions.find(
    (t) => convertNpub(t.pubkey) === convertNpub(params.pubkey)
  );

  // Filter esims with matching requests
  const esimsWithRequest = esims.filter((esim) =>
    currentTransactions?.transactions?.some(
      (transaction) => transaction.request && transaction.request === esim.request
    )
  );

  // Filter vpns with matching requests
  const vpnsWithRequest = vpn.filter((esim) =>
    currentTransactions?.transactions?.some((tx) => {
      return tx.request && esim.payment_request && tx.request === esim.payment_request;
    })
  );

  // Filter and deduplicate messages
  const filteredMessages: Message[] =
    messages
      ?.filter((msg) => (msg.pubkey || msg.sender) === convertNpub(params.pubkey))
      ?.reduce<Message[]>((unique, msg) => {
        return unique.find((item) => item.id === msg.id) ? unique : [...unique, msg];
      }, []) || [];

  const bitrefillEvents =
    params?.pubkey === 'df865ef4830496b501eebd88377c90f521469d47c53997300e225aab1b29b264'
      ? events
      : [];

  // Combine all timeline items and sort by date
  const timelimeItems: TimelineItemType[] = [
    ...esimsWithRequest,
    ...vpnsWithRequest,
    ...(currentTransactions?.transactions || []),
    ...filteredMessages,
    ...bitrefillEvents,
  ].sort((a: TimelineItemType, b: TimelineItemType) => {
    const getDate = (item: TimelineItemType) => {
      const vpnDate = item?.cc ? item.created_at : null;
      return (
        item?.date || item?.order?.packageList?.[0]?.createTime || vpnDate || item.created_at * 1000
      );
    };
    return new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime();
  });

  // Group timeline items by date
  const timelineItemsGroupedByDate = timelimeItems.reduce<Record<string, TimelineItemType[]>>(
    (groups, item) => {
      const getDate = (item: TimelineItemType) => {
        const vpnDate = 'cc' in item ? item.created_at : null;
        return (
          (item as any)?.date ||
          (item as any)?.order?.packageList?.[0]?.createTime ||
          vpnDate ||
          item.created_at * 1000
        );
      };

      const date = moment(getDate(item)).format('YYYY-MM-DD');
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(item);
      return groups;
    },
    {}
  );

  // Handle long press on timeline items
  const handleLongPress = (item: TimelineItemType) => {
    let options = ['Cancel'];
    let cancelButtonIndex = 0;
    let destructiveButtonIndex = -1;

    if (item.order || item?.request) {
      options = ['View Details', 'Cancel'];
      destructiveButtonIndex = 0;
      cancelButtonIndex = 1;
    }

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
        destructiveButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex === 0 && options.length > 1) {
          if (item.order) {
            const { package: p, order: o } = item;
            if (item?.cc) {
              navigation.navigate('vpn', { ...item });
            } else {
              navigation.navigate('esim', { ...p, ...item, ...o });
            }
          } else {
            navigation.navigate('transaction', {
              id: item.request,
              transactionType: item.transactionType,
            });
          }
        }
      }
    );
  };

  // Send DM handler
  const handleSendDM = async () => {
    try {
      const recipientPubKey = convertNpub(params.pubkey);

      const sentEvent = await sendEncryptedDirectMessage({
        nsec: currentProfile.nsec,
        recipientPublicKey: recipientPubKey,
        message,
      });

      addMessage(sentEvent.pubkey, {
        sender: sentEvent.pubkey,
        receiver: recipientPubKey,
        pubkey: recipientPubKey,
        content: message,
        created_at: sentEvent.created_at,
        id: sentEvent.id,
      });

      Alert.alert('Success', 'Message sent successfully!');
      setMessage('');
    } catch {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  // Render grouped timeline items
  const renderGroupedItems = () => {
    return Object.keys(timelineItemsGroupedByDate)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map((date, index) => (
        <View style={{ backgroundColor: 'transparent' }} key={index}>
          <Text style={styles.dateHeaderText}>{moment(date).format('dddd, MMMM Do YYYY')}</Text>
          {timelineItemsGroupedByDate[date].map((item, idx) => (
            <Pressable key={idx} onLongPress={() => handleLongPress(item)}>
              <TimelineItem item={item} theme={theme} />
            </Pressable>
          ))}
        </View>
      ));
  };

  // Get user profile for Lightning payment
  const currentUserProfile = combinedSearchAndProfiles.find(
    (p) => convertNpub(p.pubkey) === convertNpub(params?.pubkey)
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <Modal
        inverted
        title={
          <>
            <Header
              theme={theme}
              combinedSearchAndProfiles={combinedSearchAndProfiles}
              params={params}
              profiles={profiles}
            />
          </>
        }
        padding={24}
        buttons={
          <>
            <ButtonHandler
              style={{
                paddingBottom: 0,
              }}
              buttons={[
                {
                  text: 'Send Money',
                  variant: 'primary',
                  onPress: () => {
                    SheetManager.show('button-handler', {
                      payload: {
                        buttons: [
                          {
                            text: 'Lightning',
                            icon: 'mingcute:lightning-fill',
                            variant: 'primary',
                            onPress: () => {
                              navigation.navigate('currency', {
                                to: 'lightningSendConfirmation',
                                unit: 'sat',
                                lud16: currentUserProfile?.lud16,
                                pubkey: currentUserProfile?.pubkey,
                                profile: currentUserProfile,
                              });
                            },
                          },
                          {
                            text: 'Lock Ecash',
                            icon: 'solar:key-bold',
                            variant: 'primary',
                            onPress: () => {
                              navigation.navigate('currency', {
                                to: 'ecashSendConfirmation',
                                unit: 'sat',
                                profile: currentUserProfile,
                              });
                            },
                          },
                        ],
                      },
                    });
                  },
                },
              ]}
            />
            {currentProfile?.nsec ? (
              <Footer
                theme={theme}
                message={message}
                setMessage={setMessage}
                handleSendDM={handleSendDM}
              />
            ) : (
              <Button
                text={'Sign in to send and receive messages'}
                variant="primary"
                onPress={() => navigation.navigate('nostrSettings')}
              />
            )}
          </>
        }
        style={styles.container}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            margin: 16,
            marginTop: 128,
            marginBottom: 158,
          }}>
          {Object.keys(timelineItemsGroupedByDate).length === 0 ? (
            <Text style={styles.noItemsText}>No activity yet</Text>
          ) : (
            renderGroupedItems()
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    inner: {
      padding: 24,
      flex: 1,
      justifyContent: 'space-around',
    },
    header: {
      fontSize: 36,
      marginBottom: 48,
    },
    textInput: {
      height: 40,
      borderColor: '#000000',
      borderBottomWidth: 1,
      marginBottom: 36,
    },
    btnContainer: {
      backgroundColor: 'white',
      marginTop: 12,
    },
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    noItemsText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      color: greys(theme)[400],
      textAlign: 'center',
      marginVertical: 16,
    },
    dateHeaderText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      color: greys(theme)[400],
      textAlign: 'center',
      marginVertical: 16,
    },
  });
