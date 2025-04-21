import React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Alert,
  Animated,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TextInput,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { useNavigation, useRoute } from '@react-navigation/native';
import { finalizeEvent, nip04, nip19, SimplePool } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import moment from 'moment';

// Custom hooks
import { useNostr } from 'helper/redux/nostr';
import { useCashu } from 'helper/redux/cashu';
import { useEsims } from 'helper/redux/esim';
import { useVpn } from 'helper/redux/lnvpn';
import { useBitrefill } from 'helper/redux/bitrefill';
import { memoizedGetTheme } from 'helper/redux/settings';

// Components
import Modal from 'components/layout/Modal';
import { greys } from 'helper/colors';
import { Text, View } from 'components/common/Themed';
import Footer from './Footer';
import Header from './Header';
import TimelineItem from './TimeLine';
import { Button } from 'components/common/Button';
import ndk from 'components/ndk';
import { BITREFILL_NOSTR_PUBKEY } from '../bitrefill';
import { ButtonHandler } from '../ecashSendConfirmation';

// Function to fetch Nostr profile
export const fetchNostrProfile = async (npub) => {
  const profile = await ndk.getUser({ pubkey: npub });
  return profile.fetchProfile();
};

// Function to send DM via Nostr
async function sendDM(priv, pub, toPubkey, message, relays) {
  const encryptMessage = async (privKey, recipientPubKey, message) => {
    return nip04.encrypt(priv, recipientPubKey, message);
  };

  const signEventAsync = async (privKey, event) => {
    return finalizeEvent(event, hexToBytes(priv));
  };

  const content = await encryptMessage(priv, toPubkey, message);
  const event = {
    kind: 4,
    tags: [['p', toPubkey]],
    content,
    pubkey: pub,
    created_at: Math.floor(Date.now() / 1000),
    id: '',
    sig: '',
  };

  const signedEvent = await signEventAsync(priv, event);
  if (!signedEvent) {
    throw new Error("Couldn't sign the event!");
  }

  return new Promise((resolve, reject) => {
    const pool = new SimplePool();
    const pubs = pool.publish(relays, signedEvent);

    Promise.any(pubs)
      .then(() => resolve(signedEvent))
      .catch((error) => reject(`Failed to publish: ${error}`))
      .finally(() => pool.close(relays));
  });
}

export default function ModalScreen() {
  // Hooks and state
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const { params } = useRoute();
  const navigation = useNavigation();
  const { profiles, search, setSearch, messages, addMessage, currentProfile } = useNostr();
  const { transactions } = useCashu();
  const { esims } = useEsims();
  const { vpn } = useVpn();
  const { events } = useBitrefill();
  const { showActionSheetWithOptions } = useActionSheet();
  const scrollViewRef = useRef(null);

  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Animations
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const paddingAnim = useRef(new Animated.Value(1)).current;
  const paddingAnim2 = useRef(new Animated.Value(8)).current;

  // Create styles based on theme

  // Fetch profile on mount
  useEffect(() => {
    (async () => {
      const profile = await fetchNostrProfile(params.pubkey);
      // Update search with profile data
      if (search.find((p) => p.pubkey === params.pubkey)) {
        setSearch(
          search.map((p) => {
            if (p.pubkey === params.pubkey) {
              return {
                pubkey: p.pubkey,
                profile: { ...p.profile, ...profile },
              };
            }
            return p;
          })
        );
      } else {
        setSearch([...search, { pubkey: params.pubkey, profile }]);
      }
    })();
  }, []);

  // Handle animation effects
  useEffect(() => {
    Animated.timing(scaleAnim, {
      toValue: isFocused ? 0.5 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    Animated.timing(paddingAnim, {
      toValue: isFocused ? 0.75 : 1,
      duration: 300,
      useNativeDriver: false,
    }).start();

    Animated.timing(paddingAnim2, {
      toValue: isFocused ? -16 : 8,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [isFocused]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollToEnd({ animated: false });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [filteredMessages]);

  // Combine profiles and search results
  const combinedSearchAndProfiles = [
    ...profiles,
    ...search.map((s) => ({ pubkey: s.pubkey, ...s.profile })),
  ];

  // Filter and organize transactions
  const filteredTransactions = transactions.filter((t) => t?.nostr?.pubkey);

  // Group transactions by pubkey
  const groupedTransactions = filteredTransactions.reduce((acc, transaction) => {
    const pubkey = transaction.nostr.pubkey;
    if (!acc[pubkey]) {
      acc[pubkey] = { pubkey, transactions: [] };
    }
    acc[pubkey].transactions.push(transaction);
    return acc;
  }, {});

  const enrichedTransactions = Object.values(groupedTransactions).map((group) => {
    const profile = combinedSearchAndProfiles.find((p) => p.pubkey === group.pubkey);
    return {
      pubkey: group.pubkey,
      profile: profile || null,
      transactions: group.transactions,
    };
  });

  const currentTransactions = enrichedTransactions.find((t) => t.pubkey === params.pubkey);

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
  const filteredMessages = messages
    .filter((msg) => (msg.pubkey || msg.sender) === params.pubkey)
    .reduce((unique, msg) => {
      return unique.find((item) => item.id === msg.id) ? unique : [...unique, msg];
    }, []);

  // Combine all timeline items and sort by date
  const timelimeItems = [
    ...esimsWithRequest,
    ...vpnsWithRequest,
    ...(currentTransactions?.transactions || []),
    ...filteredMessages,
    ...events.filter((event) => params.pubkey === BITREFILL_NOSTR_PUBKEY),
  ].sort((a, b) => {
    const getDate = (item) => {
      const vpnDate = item?.cc ? item.created_at : null;
      return (
        item?.date || item?.order?.packageList?.[0]?.createTime || vpnDate || item.created_at * 1000
      );
    };
    return new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime();
  });

  // Group timeline items by date
  const timelineItemsGroupedByDate = timelimeItems.reduce((groups, item) => {
    const getDate = (item) => {
      const vpnDate = item?.cc ? item.created_at : null;
      return (
        item?.date || item?.order?.packageList?.[0]?.createTime || vpnDate || item.created_at * 1000
      );
    };

    const date = moment(getDate(item)).format('YYYY-MM-DD');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(item);
    return groups;
  }, {});

  // Handle long press on timeline items
  const handleLongPress = (item) => {
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
      const recipientPubKey = params.pubkey;
      const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
      const privKey = bytesToHex(privKeyBytes);
      const pubKey = currentProfile.pubkey;

      // Common relays
      const relays = [
        'wss://relay1.nostrchat.io',
        'wss://relay2.nostrchat.io',
        'wss://relay.damus.io',
        'wss://relay.snort.social',
        'wss://nos.lol',
        'wss://purplepag.es',
        'wss://relay.primal.net',
        'wss://nostr.thank.eu',
        'wss://relay.vanderwarker.family',
        'wss://nostr-relay.bitcoin.ninja',
        'wss://lnbits.btc-payserver.eu/nostrrelay/1',
        'wss://nostr.girino.org',
      ];

      const sentEvent = await sendDM(privKey, pubKey, recipientPubKey, message, relays);

      addMessage(pubKey, {
        sender: pubKey,
        receiver: recipientPubKey,
        pubkey: recipientPubKey,
        content: message,
        created_at: sentEvent.created_at,
        id: sentEvent.id,
      });

      Alert.alert('Success', 'Message sent successfully!');
      setMessage('');
    } catch (error) {
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
  const currentUserProfile = combinedSearchAndProfiles.find((p) => p.pubkey === params.pubkey);

  // return <KeyboardAvoidingComponent />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <Modal
        inverted
        title={
          <>
            <Header
              scaleAnim={scaleAnim}
              paddingAnim={paddingAnim}
              paddingAnim2={paddingAnim2}
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
                    navigation.navigate('currency', {
                      to: 'lightningSendConfirmation',
                      unit: 'sat',
                      lud16: currentUserProfile?.lud16,
                      pubkey: currentUserProfile?.pubkey,
                    });
                  },
                },
                // ...(currentProfile?.nsec
                //   ? [
                //       {
                //         text: "Send DM",
                //         variant: "secondary",
                //         disabled: !message,
                //         onPress: handleSendDM,
                //       },
                //     ]
                //   : [
                //       {
                //         text: "Sign in to send and receive messages",
                //         variant: "primary",
                //         onPress: () => navigation.navigate("nostrSettings"),
                //       },
                //     ]),
              ]}
            />
            {currentProfile?.nsec ? (
              <Footer
                theme={theme}
                message={message}
                setMessage={setMessage}
                handleSendDM={handleSendDM}
                isFocused={isFocused}
                setIsFocused={setIsFocused}
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

const KeyboardAvoidingComponent = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.inner}>
        <Text style={styles.header}>Header</Text>
        <TextInput placeholder="Username" style={styles.textInput} />
        <View style={styles.btnContainer}>
          <Button title="Submit" onPress={() => null} />
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
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
      color: greys(theme)[700],
      textAlign: 'center',
      marginVertical: 16,
    },
    dateHeaderText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      color: greys(theme)[700],
      textAlign: 'center',
      marginVertical: 16,
    },
  });
