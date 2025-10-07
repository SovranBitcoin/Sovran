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
} from 'redux/nostr';
import { usePaginatedHistory } from 'coco-cashu-react';
import { useTheme } from 'providers/ThemeProvider';

// Components
import Modal from 'components/blocks/Modal';
import { VStack, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import TimelineItem from './TimeLine';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { SheetManager } from 'react-native-actions-sheet';
import { useLocalSearchParams, router } from 'expo-router';
import { sendEncryptedDirectMessage } from 'helper/nostrClient';
import Icon, { ArrowIcon } from 'assets/icons';
import { BlurView } from 'expo-blur';
import CachedImage from 'components/ui/Image';
import { popup } from '@/helper/popup';
import { RootState } from 'redux/store/reducer';
import TextInput from 'components/ui/TextInput';
import { Button } from 'components/ui/Button';
import { nip19 } from 'nostr-tools';
import { Avatar } from 'components/ui/Avatar';
import { PUBLIC_KEYS } from 'helper/constants';
import { maybeConvertNpub } from '@/helper/coco/utils';

export type TimelineItemType = Message | any; // TODO: Replace with proper Coco transaction type

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
  const { getPrimaryColor } = useTheme();
  const dispatch = useDispatch();

  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();
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

  // Auto-scroll to bottom when component mounts or timeline changes
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
    return () => clearTimeout(timer);
  }, [timelineItemsGroupedByDate]);

  // Get profile only when needed
  const currentUserProfile = search.find((s) => convertNpub(s.pubkey) === targetPubkey)?.profile;

  // Header handlers
  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
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
          router.push({
            pathname: '/transaction',
            params: {
              id: (item as any).request,
              transactionType: (item as any).transactionType,
            },
          });
        }
      }
    );
  };

  // Send DM handler
  const handleSendDM = async () => {
    try {
      const recipientPubKey = convertNpub(pubkey);

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
        <Text className="text-primary-400 my-4 text-center text-sm font-bold">
          {moment(date).format('dddd, MMMM Do YYYY')}
        </Text>
        {timelineItemsGroupedByDate[date].map((item, idx) => (
          <Pressable
            key={idx}
            onLongPress={() => handleLongPress(item)}
            style={{ minHeight: 60 }} // Ensure minimum height for each item
          >
            <TimelineItem item={item} />
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
                <Button
                  onPress={handleGoBack}
                  icon={<ArrowIcon size={24} rotate={-135} color={getPrimaryColor('0')} />}
                  blur
                />

                {/* Profile Information */}
                <VStack align="center" justify="center" className="flex-1">
                  {profileImage && (
                    <VStack align="center" className="h-18 relative mr-2">
                      <Avatar
                        picture={profileImage}
                        variant="person"
                        status={
                          Object.values(PUBLIC_KEYS).includes(profile?.pubkey)
                            ? 'VERIFIED'
                            : undefined
                        }
                        size={72}
                      />
                      <Animated.View className="w-full pt-1.5">
                        <Text className="text-primary-0 w-full text-base font-bold">
                          {displayName}
                        </Text>
                      </Animated.View>
                    </VStack>
                  )}
                </VStack>

                {/* Info Button */}
                <Button
                  onPress={() => {
                    SheetManager.show('button-handler', {
                      payload: {
                        buttons: [
                          {
                            variant: 'secondary',
                            icon: 'majesticons:text',
                            text: 'Feed',
                            onPress: async () => {
                              router.push({
                                pathname: '/feed',
                                params: {
                                  pubkey,
                                },
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
                                await popup({ message: 'Contact removed', type: 'success' });
                              } else {
                                dispatch(addContact({ pubkey, profile }));
                                await popup({ message: 'Contact added', type: 'success' });
                              }
                            },
                          },
                          {
                            variant: 'secondary',
                            icon: 'la:user-slash',
                            text: 'Mute User',
                            onPress: async () => {
                              await popup({
                                message: 'User muted successfully',
                                type: 'success',
                              });
                              dispatch(muteUser(pubkey));
                            },
                          },
                          {
                            variant: 'secondary',
                            icon: 'material-symbols:report-rounded',
                            text: 'Report User',
                            onPress: async () => {
                              await popup({
                                message: 'User reported successfully',
                                type: 'success',
                              });
                              dispatch(reportUser(pubkey));
                            },
                          },
                        ],
                      },
                    });
                  }}
                  icon={
                    <Icon
                      name="material-symbols:info-rounded"
                      size={24}
                      color={getPrimaryColor('0')}
                    />
                  }
                  blur
                />
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
                              router.push({
                                pathname: '/currency',
                                params: {
                                  to: 'lightningSendConfirmation',
                                  unit: 'sat',
                                  lud16: currentUserProfile?.lud16,
                                  pubkey: currentUserProfile?.pubkey,
                                  profile: JSON.stringify(currentUserProfile),
                                },
                              });
                            },
                          },
                          {
                            text: 'Lock Ecash',
                            icon: 'solar:key-bold',
                            variant: 'primary',
                            onPress: async () => {
                              router.push({
                                pathname: '/currency',
                                params: {
                                  to: 'ecashSendConfirmation',
                                  unit: 'sat',
                                  profile: JSON.stringify(currentUserProfile),
                                },
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
            <Text className="text-primary-400 my-4 text-center text-sm font-bold">
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
