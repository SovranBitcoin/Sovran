import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useActionSheet } from '@expo/react-native-action-sheet';
import moment from 'moment';
import _ from 'lodash';

// Custom hooks
import {
  memoizedMessagesByProfile,
  Message,
  useNostr,
  muteUser,
  reportUser,
  addContact,
  removeContact,
} from 'helper/redux/nostr';
import { TransactionBuilder } from 'helper/redux/cashu';
import { usePaginatedHistory } from 'coco-cashu-react';
import { memoizedGetTheme } from 'helper/redux/settings';

// Components
import Modal from 'components/blocks/Modal';
import { greys } from 'helper/colors';
import { View, VStack, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import TimelineItem from './TimeLine';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { SheetManager } from 'react-native-actions-sheet';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { sendEncryptedDirectMessage } from 'helper/nostrClient';
import Icon, { ArrowIcon, VerifiedIcon } from 'assets/icons';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';
import CachedImage from 'components/ui/Image';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { showMessage } from 'helper/popup/popups';
import { RootState } from 'helper/redux/store/reducer';
import TextInput from 'components/ui/TextInput';
import { Button } from 'components/ui/Button';
import { nip19 } from 'nostr-tools';
import { maybeConvertNpub } from '@/helper/cashuClient';

export type TimelineItemType = Message | TransactionBuilder;

export function convertNpub(pubkey: string) {
  try {
    const npub = nip19.decode(pubkey);
    if (npub?.type === 'npub') return maybeConvertNpub(pubkey)?.slice(2);
  } catch {
    return pubkey;
  }
  return maybeConvertNpub(pubkey)?.slice(2);
}

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const dispatch = useDispatch();

  const { pubkey } = useTypedRoute<'userMessages'>();

  const navigation = useTypedNavigation<'currency'>();
  const { profiles, search, addMessage, currentProfile } = useNostr();
  const messages = useSelector(memoizedMessagesByProfile());
  const { history: transactions } = usePaginatedHistory();
  const { showActionSheetWithOptions } = useActionSheet();

  const [message, setMessage] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  const targetPubkey = convertNpub(pubkey);

  // Header data
  const maxWidth = Math.min(Dimensions.get('window').width, 600);
  const bannerHeight = (maxWidth * 214) / 600 + 32;
  const combinedSearchAndProfiles = search.map((s) => ({
    pubkey: convertNpub(s.pubkey),
    ...s.profile,
  }));
  const profile = combinedSearchAndProfiles.find((p) => p.pubkey === pubkey);
  const isVerified = profiles.some((p) => p.pubkey === pubkey);
  const profileImage = profile?.picture || profile?.image;
  const displayName =
    profile?.displayName ||
    profile?.display_name ||
    profile?.username ||
    profile?.name ||
    'Unknown User';
  const contacts = useSelector((state: RootState) => state.nostr.contacts || []);
  const isContact = contacts.some((c) => c.pubkey === pubkey);

  // Auto-scroll to bottom when component mounts or timeline changes
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
    return () => clearTimeout(timer);
  }, [timelineItemsGroupedByDate]);

  // ONE STEP: Get all timeline items for this user
  const timelineItemsGroupedByDate = useMemo(() => {
    const allItems = [
      // Get user's transactions
      ...transactions.filter(
        (t) => t?.nostr?.pubkey && convertNpub(t.nostr.pubkey) === targetPubkey
      ),
      // Get user's messages (deduplicated)
      ..._.uniqBy(
        messages.filter((msg) => convertNpub(msg.pubkey || msg.sender) === targetPubkey),
        'id'
      ),
    ];

    // Sort and group by date in one step
    return _.groupBy(
      allItems.sort((a, b) => {
        const dateA = (a as any)?.date || a.created_at * 1000;
        const dateB = (b as any)?.date || b.created_at * 1000;
        return dateA - dateB;
      }),
      (item) => moment((item as any)?.date || item.created_at * 1000).format('YYYY-MM-DD')
    );
  }, [transactions, messages, targetPubkey]);

  // Get profile only when needed
  const currentUserProfile = search.find((s) => convertNpub(s.pubkey) === targetPubkey)?.profile;

  // Header handlers
  const handleGoBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      console.warn('No previous screen to go back to.');
    }
  };

  // Handle long press on timeline items
  const handleLongPress = (item: TimelineItemType) => {
    let options = ['Cancel'];
    let cancelButtonIndex = 0;
    let destructiveButtonIndex = -1;

    if ((item as any)?.request) {
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
          navigation.navigate('transaction', {
            id: (item as any).request,
            transactionType: (item as any).transactionType,
          });
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
    return _.sortBy(Object.keys(timelineItemsGroupedByDate), (date) =>
      new Date(date).getTime()
    ).map((date, index) => (
      <VStack key={index}>
        <Text className="my-4 text-center text-sm font-bold" style={{ color: greys(theme)[400] }}>
          {moment(date).format('dddd, MMMM Do YYYY')}
        </Text>
        {timelineItemsGroupedByDate[date].map((item, idx) => (
          <Pressable
            key={idx}
            onLongPress={() => handleLongPress(item)}
            style={{ minHeight: 60 }} // Ensure minimum height for each item
          >
            <TimelineItem item={item} theme={theme} />
          </Pressable>
        ))}
      </VStack>
    ));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1">
      <Modal
        inverted
        title={
          <>
            <HStack align="center" justify="center">
              {/* Banner Image */}
              <CachedImage
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: 0.66,
                  width: maxWidth,
                  height: bannerHeight,
                }}
                source={{ uri: profile?.banner }}
              />

              {/* Blur Effect */}
              <BlurView
                tint="default"
                intensity={33}
                experimentalBlurMethod="dimezisBlurView"
                className="absolute bottom-0 left-0 right-0 top-0 pt-8"
                style={{ width: maxWidth, height: bannerHeight }}
              />

              {/* Header Content */}
              <HStack
                className="mt-8"
                style={{ width: maxWidth }}
                align="center"
                justify="space-around">
                {/* Back Button */}
                <TouchableOpacity
                  onPress={handleGoBack}
                  className="ml-3 h-12 w-12 rounded-full"
                  style={{ backgroundColor: opacity(greys(theme)[950], 0.25) }}>
                  <HStack align="center" justify="center" flex={1}>
                    <ArrowIcon size={24} rotate={-135} color={greys(theme)[0]} />
                  </HStack>
                </TouchableOpacity>

                {/* Profile Information */}
                <VStack align="center" justify="center" className="flex-1">
                  {profileImage && (
                    <VStack align="center" className="h-18 relative mr-2">
                      {isVerified && (
                        <View
                          className="absolute -bottom-1 -right-1 z-50 h-7 w-7 rounded-full p-0.5"
                          style={{ backgroundColor: greys(theme)[950] }}>
                          <VerifiedIcon />
                        </View>
                      )}
                      <CachedImage
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 1000,
                          borderWidth: 0.2,
                          borderColor: greys(theme)[600],
                        }}
                        source={{ uri: profileImage }}
                      />
                      <Animated.View className="w-full pt-1.5">
                        <Text
                          className="w-full text-base font-bold"
                          style={{ color: greys(theme)[0] }}>
                          {displayName}
                        </Text>
                      </Animated.View>
                    </VStack>
                  )}
                </VStack>

                {/* Info Button */}
                <TouchableOpacity
                  onPress={() => {
                    SheetManager.show('button-handler', {
                      payload: {
                        buttons: [
                          {
                            variant: 'secondary',
                            icon: 'majesticons:text',
                            text: 'Feed',
                            onPress: async () => {
                              navigation.navigate('feed/index', {
                                pubkey,
                              });
                            },
                          },
                          {
                            variant: 'secondary',
                            icon: isContact ? 'la:user-minus' : 'la:user-plus',
                            text: isContact ? 'Remove Contact' : 'Add Contact',
                            onPress: async () => {
                              if (isContact) {
                                dispatch(removeContact(pubkey));
                                await showMessage('Contact removed');
                              } else {
                                dispatch(addContact({ pubkey, profile }));
                                await showMessage('Contact added');
                              }
                            },
                          },
                          {
                            variant: 'secondary',
                            icon: 'la:user-slash',
                            text: 'Mute User',
                            onPress: async () => {
                              await showMessage('User muted successfully');
                              dispatch(muteUser(pubkey));
                            },
                          },
                          {
                            variant: 'secondary',
                            icon: 'material-symbols:report-rounded',
                            text: 'Report User',
                            onPress: async () => {
                              await showMessage('User reported successfully');
                              dispatch(reportUser(pubkey));
                            },
                          },
                        ],
                      },
                    });
                  }}
                  className="mr-3 h-12 w-12 rounded-full"
                  style={{ backgroundColor: opacity(greys(theme)[950], 0.25) }}>
                  <HStack align="center" justify="center" flex={1}>
                    <Icon name="material-symbols:info-rounded" size={24} color={greys(theme)[0]} />
                  </HStack>
                </TouchableOpacity>
              </HStack>
            </HStack>
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
                  onPress: async () => {
                    SheetManager.show('button-handler', {
                      payload: {
                        buttons: [
                          {
                            text: 'Lightning',
                            icon: 'mingcute:lightning-fill',
                            variant: 'primary',
                            onPress: async () => {
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
                            onPress: async () => {
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
            {currentProfile?.nsec && (
              <HStack align="center" spacing={2} className="relative">
                <TextInput
                  placeholder="Type your message..."
                  value={message}
                  onChangeText={setMessage}
                  className="ml-3 flex-1 p-3 text-base"
                />

                <Button
                  variant="secondary"
                  icon={<Icon name="iconamoon:send-fill" />}
                  onPress={handleSendDM}
                  style={{
                    width: 56,
                    height: 56,
                    marginRight: 8,
                    paddingVertical: 0,
                  }}
                />
              </HStack>
            )}
          </>
        }
        className="flex-1">
        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          contentContainerStyle={{
            paddingTop: 128, // Account for header
            paddingBottom: 160, // Account for input area
            paddingHorizontal: 16,
            minHeight: 200,
          }}
          showsVerticalScrollIndicator={false}>
          {Object.keys(timelineItemsGroupedByDate).length === 0 ? (
            <Text
              className="my-4 text-center text-sm font-bold"
              style={{ color: greys(theme)[400] }}>
              No activity yet
            </Text>
          ) : (
            renderGroupedItems()
          )}
        </ScrollView>
      </Modal>
    </KeyboardAvoidingView>
  );
}
