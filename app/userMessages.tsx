import { useMemo, useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Animated,
  Dimensions,
  Text as RNText,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { SheetManager } from 'react-native-actions-sheet';

// Custom hooks
import { Message } from 'redux/nostr';
import { useTheme } from 'providers/ThemeProvider';

// Components
import { View, VStack, HStack } from 'components/ui/View';
import { nip19 } from 'nostr-tools';
import { maybeConvertNpub } from '@/helper/coco/utils';
import { withSheetProvider } from '@/hocs/withSheetProvider';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata, EncryptedDirectMessage } from 'nostr-tools/kinds';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import TextInput from 'components/ui/TextInput';
import Icon from 'assets/icons';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

export type TimelineItemType = Message;

export function convertNpub(pubkey: string) {
  try {
    const npub = nip19.decode(pubkey);
    if (npub?.type === 'npub') return maybeConvertNpub(pubkey)?.slice(2);
  } catch {
    return pubkey;
  }
  return maybeConvertNpub(pubkey)?.slice(2);
}

// Helper function to format timestamp
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInHours < 48) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString();
  }
}

// Animated scrolling text component for overflow handling
function AnimatedScrollingText({
  text,
  style,
  maxWidth,
}: {
  text: string;
  style: any;
  maxWidth: number;
}) {
  const scrollX = useRef(new Animated.Value(0)).current;
  const [textWidth, setTextWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(maxWidth);

  const shouldAnimate = textWidth > containerWidth;

  useEffect(() => {
    if (shouldAnimate) {
      const scrollDistance = textWidth - containerWidth;
      const duration = Math.max(3000, scrollDistance * 30);

      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(1000),
          Animated.timing(scrollX, {
            toValue: -scrollDistance,
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.delay(1000),
          Animated.timing(scrollX, {
            toValue: 0,
            duration: duration,
            useNativeDriver: true,
          }),
        ])
      );

      animation.start();

      return () => {
        animation.stop();
        scrollX.setValue(0);
      };
    } else {
      scrollX.setValue(0);
    }
  }, [shouldAnimate, textWidth, containerWidth, scrollX]);

  const onTextLayout = (event: any) => {
    const width = event.nativeEvent.layout.width;
    setTextWidth(width);
  };

  const onContainerLayout = (event: any) => {
    const width = event.nativeEvent.layout.width;
    setContainerWidth(width);
  };

  return (
    <View style={{ width: maxWidth, overflow: 'hidden' }} onLayout={onContainerLayout}>
      <Animated.View
        style={{
          transform: [{ translateX: scrollX }],
        }}>
        <RNText style={style} onLayout={onTextLayout} numberOfLines={1}>
          {text}
        </RNText>
      </Animated.View>
    </View>
  );
}

function MessageBubble({
  message,
  isMe,
  userPicture,
  isLoadingMetadata,
}: {
  message: any;
  isMe: boolean;
  userPicture?: string;
  isLoadingMetadata?: boolean;
}) {
  const { getPrimaryColor, getShadeColor } = useTheme();

  return (
    <HStack
      align="flex-start"
      justify={isMe ? 'flex-end' : 'flex-start'}
      spacing={8}
      style={{ marginBottom: 16 }}>
      {!isMe && (
        <Avatar
          size={32}
          picture={userPicture}
          seed={message.pubkey}
          name={message.sender === 'other' ? 'Other User' : 'Me'}
          loading={isLoadingMetadata}
        />
      )}

      <VStack align={isMe ? 'flex-end' : 'flex-start'} spacing={4}>
        <View
          style={{
            backgroundColor: isMe ? getPrimaryColor('600') : getPrimaryColor('700'),
            // paddingHorizontal: 16,
            // paddingVertical: 12,
            borderRadius: 18,
            borderTopLeftRadius: isMe ? 18 : 4,
            borderTopRightRadius: isMe ? 4 : 18,
            maxWidth: '85%',
            // minWidth: 60,
            alignSelf: isMe ? 'flex-end' : 'flex-start',
          }}>
          <Text
            size={16}
            style={{
              color: getPrimaryColor('0'),
              lineHeight: 20,
              marginHorizontal: 16,
              marginVertical: 12,
              flexShrink: 1,
              flexWrap: 'wrap', // ensures wrapping inside the parent View
            }}>
            {message.content}
          </Text>
        </View>

        <HStack align="center" spacing={4}>
          <Text
            size={12}
            style={{
              color: getShadeColor('400'),
              marginLeft: isMe ? 0 : 8,
            }}>
            {message.timestamp}
          </Text>
          {isMe && (
            <Icon
              name={message.isRead ? 'ion:checkmark-done' : 'simple-line-icons:check'}
              size={14}
              color={message.isRead ? getPrimaryColor('400') : getShadeColor('500')}
            />
          )}
        </HStack>
      </VStack>

      {isMe && <Avatar size={32} seed={message.pubkey} name="Me" loading={false} />}
    </HStack>
  );
}

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();
  const [messages, setMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;

  const { getPrimaryColor, getShadeColor } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();

  // Get user metadata
  const metadataFilters = useMemo(
    () => [
      {
        authors: [pubkey],
        kinds: [Metadata],
        limit: 1,
      },
    ],
    [pubkey]
  );

  const { events: metadataEvents, eose: metadataEose } = useSubscribe({
    filters: metadataFilters,
  });

  // Loading state: true until we receive EOSE (end of stored events)
  const isMetadataLoading = !metadataEose;

  // Get DMs between current user and the other user
  const dmFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;

    return [
      {
        kinds: [EncryptedDirectMessage],
        authors: [nostrKeys.pubkey],
        '#p': [pubkey],
      },
      {
        kinds: [EncryptedDirectMessage],
        '#p': [nostrKeys.pubkey],
        authors: [pubkey],
      },
    ];
  }, [pubkey, nostrKeys?.pubkey]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // Get user info from metadata events
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = userInfo?.display_name || userInfo?.name || 'Unknown User';
  const userPicture = userInfo?.picture;
  const lud16 = userInfo?.lud16;

  // Only show loading if we're still fetching metadata AND we don't have user info yet
  const shouldShowAvatarLoading = isMetadataLoading && !userInfo;

  // Process and decrypt DM events
  useEffect(() => {
    const processDMs = async () => {
      if (!dmEvents || !nostrKeys?.pubkey) {
        setIsLoading(false);
        return;
      }

      try {
        const processedMessages = await Promise.all(
          dmEvents.map(async (event) => {
            try {
              // Decrypt the message content
              await event.decrypt();

              const isMe = event.pubkey === nostrKeys.pubkey;
              const senderPubkey = isMe ? nostrKeys.pubkey : event.pubkey;

              return {
                id: event.id,
                content: event.content,
                sender: isMe ? 'me' : 'other',
                timestamp: formatTimestamp(event.created_at || 0),
                isRead: true, // For now, assume all messages are read
                created_at: event.created_at || 0,
                pubkey: senderPubkey,
              };
            } catch (error) {
              console.error('Failed to decrypt message:', error);
              return null;
            }
          })
        );

        // Filter out failed decryptions and sort by timestamp
        const validMessages = processedMessages
          .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
          .sort((a, b) => a.created_at - b.created_at);

        setMessages(validMessages);
      } catch (error) {
        console.error('Error processing DMs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    processDMs();
  }, [dmEvents, nostrKeys?.pubkey]);

  const handleSendMessage = () => {
    if (messageText.trim()) {
      // Here you would typically send the message via Nostr
      console.log('Sending message:', messageText);
      setMessageText('');
    }
  };

  const handleSendMoney = () => {
    if (!lud16 || !userInfo) return;

    SheetManager.show('button-handler', {
      payload: {
        buttons: [
          {
            text: 'Send Ecash',
            icon: 'solar:wallet-bold',
            variant: 'primary' as const,
            onPress: async (close) => {
              router.push({
                pathname: '/currency',
                params: {
                  to: 'sendToken',
                  lud16: lud16,
                  profile: JSON.stringify(userInfo),
                },
              });
              close({} as any);
            },
          },
          {
            text: 'Send Lightning',
            icon: 'mingcute:lightning-fill',
            variant: 'primary' as const,
            onPress: async (close) => {
              router.push({
                pathname: '/currency',
                params: {
                  to: 'meltQuote',
                  lnUrlOrAddress: lud16,
                  profile: JSON.stringify(userInfo),
                },
              });
              close({} as any);
            },
          },
        ],
      },
    });
  };

  console.log(123123123123223, metadataEvents);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
      <StatusBar barStyle="light-content" backgroundColor={getPrimaryColor('800')} />
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('900') }}>
        {/* Header */}
        <View
          style={{
            backgroundColor: getPrimaryColor('800'),
            paddingHorizontal: 16,
            paddingTop: insets.top + 12,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: getPrimaryColor('700'),
          }}>
          <HStack align="center" justify="space-between" style={{ height: 48 }}>
            <HStack align="center" spacing={12} style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={() => router.back()}>
                <Icon
                  name="material-symbols:arrow-back-rounded"
                  size={24}
                  color={getPrimaryColor('0')}
                />
              </Pressable>

              <Avatar
                size={40}
                picture={userPicture}
                seed={pubkey}
                name={displayName}
                loading={shouldShowAvatarLoading}
              />

              <VStack spacing={2} style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
                <AnimatedScrollingText
                  text={displayName}
                  style={{
                    fontSize: 16,
                    fontWeight: 'bold',
                    color: getPrimaryColor('0'),
                  }}
                  maxWidth={screenWidth - 240}
                />
                <Text size={12} style={{ color: getShadeColor('400') }} numberOfLines={1}>
                  {nip19.npubEncode(pubkey)}
                </Text>
              </VStack>
            </HStack>

            <HStack align="center" spacing={12} style={{ flexShrink: 0 }}>
              {/* <Pressable>
                <Icon name="mdi:contact" size={20} color={getPrimaryColor('0')} />
              </Pressable> */}
              <Pressable
                className="ml-2"
                onPress={() =>
                  router.push({
                    pathname: 'share',
                    params: {
                      type: 'profile',
                      data: nip19.npubEncode(pubkey),
                    },
                  })
                }>
                <Icon name="stash:qr-code" size={20} color={getPrimaryColor('0')} />
              </Pressable>
              {/* <Pressable>
                <Icon name="bx:dots-vertical-rounded" size={20} color={getPrimaryColor('0')} />
              </Pressable> */}
            </HStack>
          </HStack>
        </View>

        {/* Messages */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {isLoading ? (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: 50,
              }}>
              <Text size={16} style={{ color: getShadeColor('400') }}>
                Loading messages...
              </Text>
            </View>
          ) : messages.length === 0 ? (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: 50,
              }}>
              <Text size={16} style={{ color: getShadeColor('400') }}>
                No messages yet. Start the conversation!
              </Text>
            </View>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isMe={message.sender === 'me'}
                userPicture={message.sender === 'other' ? userPicture : undefined}
                isLoadingMetadata={shouldShowAvatarLoading}
              />
            ))
          )}
        </ScrollView>

        {/* Input Area */}
        <View
          style={{
            backgroundColor: getPrimaryColor('800'),
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 12,
            borderTopWidth: 1,
            borderTopColor: getPrimaryColor('700'),
          }}>
          {lud16 && (
            <Pressable
              onPress={handleSendMoney}
              style={{
                width: '100%',
                backgroundColor: getPrimaryColor('600'),
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 16,
                marginBottom: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <HStack align="center" spacing={8}>
                <Icon name="mingcute:lightning-fill" size={20} color={getPrimaryColor('0')} />
                <Text
                  size={16}
                  bold
                  style={{
                    color: getPrimaryColor('0'),
                  }}>
                  Send Money
                </Text>
              </HStack>
            </Pressable>
          )}
          <HStack align="center" spacing={12}>
            {/* <Pressable>
              <Icon name="fluent:add-24-filled" size={24} color={getPrimaryColor('0')} />
            </Pressable> */}
            <Avatar size={40} seed={nostrKeys?.pubkey} loading={false} />

            <TextInput
              value={messageText}
              onChangeText={setMessageText}
              placeholder="Type a message..."
              style={{
                flex: 1,
                backgroundColor: getPrimaryColor('700'),
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderWidth: 0,
                margin: 0,
                shadowOpacity: 0,
              }}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSendMessage}
            />

            <Pressable onPress={handleSendMessage} disabled={!messageText.trim()}>
              <Icon
                name="iconamoon:send-fill"
                size={24}
                color={messageText.trim() ? getPrimaryColor('0') : getShadeColor('500')}
              />
            </Pressable>
          </HStack>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default withSheetProvider(ModalScreen);
