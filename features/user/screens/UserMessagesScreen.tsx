/**
 * @fileoverview Direct Messages screen
 *
 * Renders a NIP-17 gift-wrapped DM thread with NIP-04 fallback for legacy
 * peers. Used by the standalone, user-flow, and mint-flow `userMessages`
 * route wrappers — `pubkey` is the recipient and is validated as a 64-hex
 * Schnorr key at the route boundary.
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  StatusBar,
  ColorValue,
  InteractionManager,
  useWindowDimensions,
} from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { invalidTokenPopup, sendMessageFailedPopup } from '@/shared/lib/popup';
import { nip19 } from 'nostr-tools';
import {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKUser,
  useNDK,
  useSubscribe,
} from '@nostr-dev-kit/ndk-mobile';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { buildGiftWrappedDMPair } from '@/shared/lib/nostr/nip17';
import { unwrapGiftWrapCached } from '@/shared/lib/nostr/giftWrapCache';
import {
  getCachedNip04Plaintext,
  isKnownFailedNip04,
  markNip04Failed,
  putNip04Plaintext,
} from '@/shared/lib/nostr/nip04Cache';
import { LegendList } from '@legendapp/list';

import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import Icon from 'assets/icons';
import { ChatComposer } from '@/shared/ui/composed/chat/ChatComposer';
import { useChatSurfacePerfLogger } from '@/shared/ui/composed/chat/useChatSurfacePerfLogger';
import { formatChatTimestamp } from '@/shared/ui/composed/chat/formatChatTimestamp';
import { Button } from '@/shared/ui/primitives/Button';

import { isValidEcashToken } from '@/shared/lib/cashu/utils';
import { mintLocalId } from '@/shared/lib/id';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { getDecodedToken, ReceiveHistoryEntry } from '@cashu/coco-core';
import { Proof } from '@cashu/cashu-ts';
import { formatAmount } from '@/shared/lib/currency';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { truncateMiddle } from '@/shared/lib/strings';
import { resolveIdentityName } from '@/shared/lib/identity';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { chatLog, Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { LightningAddress } from '@sovranbitcoin/schemas';

const PERF_SURFACE = 'nostr-dm' as const;

interface DmMessage {
  id: string;
  content: string;
  sender: 'me' | 'other';
  timestamp: string;
  isRead: boolean;
  isSending?: boolean;
  created_at: number;
  pubkey: string;
}

function extractCashuToken(content: string): string | null {
  if (!content || typeof content !== 'string') return null;

  const lowerContent = content.toLowerCase();
  const cashuAIndex = lowerContent.indexOf('cashua');
  const cashuBIndex = lowerContent.indexOf('cashub');

  let tokenStartIndex = -1;
  if (cashuAIndex !== -1 && (cashuBIndex === -1 || cashuAIndex < cashuBIndex)) {
    tokenStartIndex = cashuAIndex;
  } else if (cashuBIndex !== -1) {
    tokenStartIndex = cashuBIndex;
  }

  if (tokenStartIndex === -1) return null;

  const remainingText = content.slice(tokenStartIndex);
  let token = '';
  const maxTokenLength = 5000;

  for (let i = 6; i <= Math.min(remainingText.length, maxTokenLength); i++) {
    const candidate = remainingText.slice(0, i);
    if (isValidEcashToken(candidate)) {
      token = candidate;
    } else if (token) {
      break;
    }

    if (/\s/.test(remainingText[i]) && !token) {
      break;
    }
  }

  return token || null;
}

interface CashuTokenBubbleProps {
  token: string;
  isMe: boolean;
}

function CashuTokenBubble({ token, isMe }: CashuTokenBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, surfaceSecondary, surface, shade200, shade300] =
    useThemeColor([
      'foreground',
      'default',
      'surface-tertiary',
      'surface-secondary',
      'surface',
      'shade-200',
      'shade-300',
    ] as const);

  let decoded;
  let amount = 0;
  let unit = '';
  let mintUrl = '';
  let isValid = false;

  try {
    decoded = getDecodedToken(token);
    amount = decoded.proofs.reduce((sum: number, proof: Proof) => sum + proof.amount, 0);
    unit = decoded.unit || 'sats';
    mintUrl = decoded.mint || '';
    isValid = true;
  } catch (error) {
    log.error('user.messages.cashu_decode_failed', { error });
    isValid = false;
  }

  const usdAmount = isValid
    ? formatAmount({ amount, unit }, { displayAs: 'usd', currencyDisplay: 'symbol' })
    : '';

  const handlePress = () => {
    if (!isValid) {
      invalidTokenPopup();
      return;
    }

    const decodedToken = getDecodedToken(token);
    const receiveHistoryEntry: ReceiveHistoryEntry = {
      id: mintLocalId('receive'),
      type: 'receive',
      amount,
      unit,
      mintUrl,
      createdAt: Date.now(),
      metadata: {},
      state: 'prepared',
      token: decodedToken,
    };

    router.navigate({
      pathname: '/receiveToken',
      params: {
        receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
      },
    });
  };

  if (!isValid) {
    return null;
  }

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isMe
    ? [shade200, shade300]
    : [defaultColor, surfaceTertiary];

  const innerGradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isMe
    ? [opacity(foreground, 0.2), opacity(foreground, 0.175)]
    : [surfaceSecondary, surface];

  return (
    <View
      style={{
        marginTop: 8,
        marginBottom: 8,
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
      }}>
      <Pressable onPress={handlePress}>
        <LinearGradient
          colors={gradientColors}
          style={{
            borderRadius: 18,
            padding: 12,
            minWidth: 200,
          }}>
          <VStack spacing={8}>
            {mintUrl && (
              <Text
                size={12}
                style={{
                  color: foreground,
                  opacity: 0.75,
                }}>
                {mintUrl}
              </Text>
            )}

            <LinearGradient
              colors={innerGradientColors}
              style={{
                borderRadius: 18,
                margin: 0,
              }}>
              <VStack spacing={4} justify="center" align="center" className="p-5">
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={32}
                  weight="heavy"
                  color={foreground}
                />
                {usdAmount && (
                  <Text
                    size={14}
                    style={{
                      color: foreground,
                      opacity: 0.9,
                    }}>
                    {usdAmount}
                  </Text>
                )}
              </VStack>
            </LinearGradient>

            <Pressable
              onPress={handlePress}
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 16,
                backgroundColor: foreground,
                borderRadius: 8,
                alignItems: 'center',
              }}>
              <HStack align="center" spacing={6}>
                {!isMe && (
                  <Icon name="material-symbols:arrow-downward" size={16} color={defaultColor} />
                )}
                <Text
                  size={14}
                  bold
                  style={{
                    color: defaultColor,
                  }}>
                  {isMe ? 'Cancel' : 'Redeem'}
                </Text>
              </HStack>
            </Pressable>
          </VStack>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

interface MessageBubbleProps {
  message: DmMessage;
  isMe: boolean;
  userPicture?: string;
  userName: string;
  myName: string;
  isLoadingMetadata?: boolean;
}

function MessageBubble({
  message,
  isMe,
  userPicture,
  userName,
  myName,
  isLoadingMetadata,
}: MessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400, shade500] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
    'shade-500',
  ] as const);

  const content = message.content;
  const cashuToken = extractCashuToken(content);
  const displayContent = cashuToken ? content.replace(cashuToken, '').trim() : content;

  return (
    <VStack
      align={isMe ? 'flex-end' : 'flex-start'}
      spacing={0}
      style={{
        marginBottom: 16,
        maxWidth: '85%',
        alignSelf: isMe ? 'flex-end' : 'flex-start',
      }}>
      <HStack
        align="flex-start"
        justify={isMe ? 'flex-end' : 'flex-start'}
        spacing={8}
        style={{ width: '100%' }}>
        {!isMe && (
          <Avatar
            state={isLoadingMetadata ? 'loading' : userPicture ? 'image' : 'fallback'}
            size={32}
            picture={userPicture}
            seed={message.pubkey}
            name={userName}
          />
        )}

        <VStack
          align={isMe ? 'flex-end' : 'flex-start'}
          spacing={4}
          style={{ flex: 1, maxWidth: '85%' }}>
          {displayContent.length > 0 && (
            <View
              style={{
                backgroundColor: isMe ? defaultColor : surfaceTertiary,
                borderRadius: 18,
                borderTopLeftRadius: isMe ? 18 : 4,
                borderTopRightRadius: isMe ? 4 : 18,
                alignSelf: isMe ? 'flex-end' : 'flex-start',
              }}>
              <Text
                size={16}
                style={{
                  color: foreground,
                  lineHeight: 20,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}>
                {displayContent}
              </Text>
            </View>
          )}

          {cashuToken && <CashuTokenBubble token={cashuToken} isMe={isMe} />}

          <HStack align="center" spacing={4}>
            <Text
              size={12}
              style={{
                color: shade400,
                marginLeft: isMe ? 0 : 8,
              }}>
              {message.timestamp}
            </Text>
            {isMe &&
              (message.isSending ? (
                <Icon name="ant-design:loading-outlined" size={14} color={shade500} />
              ) : (
                <Icon
                  name={message.isRead ? 'ion:checkmark-done' : 'simple-line-icons:check'}
                  size={14}
                  color={message.isRead ? opacity(foreground, 0.4) : shade500}
                />
              ))}
          </HStack>
        </VStack>

        {isMe && <Avatar state="fallback" size={32} seed={message.pubkey} name={myName} />}
      </HStack>
    </VStack>
  );
}

interface UserMessagesScreenProps {
  pubkey: string;
  /** Optional callback for back navigation - if not provided, uses router.back() */
  onBack?: () => void;
}

export function UserMessagesScreen({ pubkey, onBack }: UserMessagesScreenProps) {
  useLifecycleLogger('UserMessagesScreen');
  const headerHeight = useHeaderHeight();
  const { width: screenWidth } = useWindowDimensions();
  const listRef = useRef<any>(null);

  const [foreground, surfaceSecondary, surface, shade400] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface',
    'shade-400',
  ] as const);
  const { keys: nostrKeys } = useNostrKeysContext();
  const { ndk } = useNDK();

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  const { handleListLayout, handleListContentSize, handleListScroll } = useChatSurfacePerfLogger({
    log: chatLog,
    surface: PERF_SURFACE,
    headerHeight,
    messages,
    kbStateExtras: () => ({ composerHeight }),
    historyExtras: (last) => ({
      lastSender: last?.sender ?? null,
      lastIsSending: last?.isSending ?? null,
    }),
  });

  // Counterparty kind-0 metadata is served from the shared SWR cache.
  // First open of a conversation per session pays one round-trip; every
  // subsequent open is instant because the cache is shared across
  // surfaces (this screen, contact picker, feed reactions, etc.) and
  // persists across app launches via profile-scoped AsyncStorage.
  const { metadata: counterpartyMetadata, isLoading: isMetadataLoading } =
    useNostrProfileMetadata(pubkey);

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

  // NIP-17: subscribe to gift-wrapped events (kind 1059) addressed to us.
  const giftWrapFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [
      {
        kinds: [1059 as number],
        '#p': [nostrKeys.pubkey],
      },
    ];
  }, [nostrKeys?.pubkey]);

  const { events: giftWrapEvents } = useSubscribe({ filters: giftWrapFilters });

  const unwrappedGiftWrapMessages = useMemo(() => {
    if (!giftWrapEvents?.length || !nostrKeys?.privateKey || !nostrKeys?.pubkey) return [];

    return giftWrapEvents
      .map((event) => {
        const unwrapped = unwrapGiftWrapCached(nostrKeys.pubkey, event, nostrKeys.privateKey);
        if (!unwrapped) return null;

        const isFromCounterparty =
          unwrapped.senderPubkey === pubkey &&
          unwrapped.recipientPubkeys.includes(nostrKeys.pubkey);
        const isFromMe =
          unwrapped.senderPubkey === nostrKeys.pubkey &&
          unwrapped.recipientPubkeys.includes(pubkey);

        if (!isFromCounterparty && !isFromMe) return null;

        return {
          wrapId: event.id,
          ...unwrapped,
        };
      })
      .filter((dm): dm is NonNullable<typeof dm> => dm !== null);
  }, [giftWrapEvents, nostrKeys?.privateKey, nostrKeys?.pubkey, pubkey]);

  const displayName = resolveIdentityName({ pubkey, nostrProfile: counterpartyMetadata });
  const userPicture = counterpartyMetadata?.picture;
  // lud16 is relay-supplied kind:0 metadata — validate the `name@host` shape
  // before plumbing it into router params / coco-payment-ux. A malformed
  // value should hide the Send Money affordance, not surface as a confusing
  // error inside LNURL resolution.
  const rawLud16 = counterpartyMetadata?.lud16;
  const lud16 = rawLud16 && LightningAddress.safeParse(rawLud16).success ? rawLud16 : undefined;
  const myProfile = useProfileDisplay(nostrKeys?.pubkey || '');
  const myName = myProfile.displayName;
  const shouldShowAvatarLoading = isMetadataLoading && !counterpartyMetadata;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const processedEventIds = useRef<Set<string>>(new Set());

  // Reset processed events when conversation changes.
  useEffect(() => {
    processedEventIds.current.clear();
    setMessages([]);
    setIsLoading(true);
  }, [pubkey]);

  // Process NIP-04 DM events - deferred to avoid blocking navigation.
  useEffect(() => {
    if (!dmEvents || !nostrKeys?.pubkey || !nostrKeys?.privateKey || !pubkey) {
      setIsLoading(false);
      return;
    }

    if (dmEvents.length === 0) {
      setIsLoading(false);
      return;
    }

    const newEvents = dmEvents.filter((event) => !processedEventIds.current.has(event.id));

    if (newEvents.length === 0) {
      setIsLoading(false);
      return;
    }

    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const myPubkey = nostrKeys.pubkey;
        const processedMessages = await Promise.all(
          newEvents.map(async (event) => {
            try {
              if (isKnownFailedNip04(myPubkey, event.id)) {
                processedEventIds.current.add(event.id);
                return null;
              }
              const cached = getCachedNip04Plaintext(myPubkey, event.id);
              if (cached !== undefined) {
                event.content = cached;
              } else {
                const counterparty = new NDKUser({ pubkey: pubkey });
                const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);
                await event.decrypt(counterparty, signer);
                putNip04Plaintext(myPubkey, event.id, event.content);
              }
              const isMe = event.pubkey === myPubkey;
              const senderPubkey = isMe ? myPubkey : event.pubkey;

              processedEventIds.current.add(event.id);

              return {
                id: event.id,
                content: event.content,
                sender: (isMe ? 'me' : 'other') as 'me' | 'other',
                timestamp: formatChatTimestamp((event.created_at || 0) * 1000),
                isRead: true,
                created_at: event.created_at || 0,
                pubkey: senderPubkey,
              } satisfies DmMessage;
            } catch (error) {
              log.error('user.messages.nip04_decrypt_failed', { error });
              markNip04Failed(nostrKeys.pubkey, event.id);
              processedEventIds.current.add(event.id);
              return null;
            }
          })
        );

        const validNewMessages = processedMessages.filter(
          (msg): msg is NonNullable<typeof msg> => msg !== null
        );

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const existingContentKeys = new Set(
            prev.map((m) => `${m.content}-${m.created_at}-${m.sender}`)
          );

          const uniqueNewMessages = validNewMessages.filter((m) => {
            if (existingIds.has(m.id)) return false;
            const contentKey = `${m.content}-${m.created_at}-${m.sender}`;
            if (existingContentKeys.has(contentKey)) return false;
            return true;
          });

          const merged = [...prev, ...uniqueNewMessages];
          return merged.sort((a, b) => a.created_at - b.created_at);
        });
      } catch (error) {
        log.error('user.messages.nip04_process_failed', { error });
      } finally {
        setIsLoading(false);
      }
    });

    return () => handle.cancel();
  }, [dmEvents, nostrKeys?.pubkey, nostrKeys?.privateKey, pubkey]);

  // Process NIP-17 gift-wrapped DM events (already decrypted by unwrapGiftWrap).
  useEffect(() => {
    if (!nostrKeys?.pubkey) return;
    if (unwrappedGiftWrapMessages.length === 0) return;

    const newMessages = unwrappedGiftWrapMessages.filter(
      (dm) => !processedEventIds.current.has(dm.wrapId)
    );

    if (newMessages.length === 0) return;

    const formatted: DmMessage[] = newMessages.map((dm) => {
      processedEventIds.current.add(dm.wrapId);
      const isMe = dm.senderPubkey === nostrKeys.pubkey;

      return {
        id: dm.wrapId,
        content: dm.content,
        sender: isMe ? 'me' : 'other',
        timestamp: formatChatTimestamp(dm.created_at * 1000),
        isRead: true,
        created_at: dm.created_at,
        pubkey: dm.senderPubkey,
      };
    });

    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const existingContentKeys = new Set(
        prev.map((m) => `${m.content}-${m.created_at}-${m.sender}`)
      );

      const uniqueNewMessages = formatted.filter((m) => {
        if (existingIds.has(m.id)) return false;
        const contentKey = `${m.content}-${m.created_at}-${m.sender}`;
        if (existingContentKeys.has(contentKey)) return false;
        return true;
      });

      if (uniqueNewMessages.length === 0) return prev;

      const merged = [...prev, ...uniqueNewMessages];
      return merged.sort((a, b) => a.created_at - b.created_at);
    });

    setIsLoading(false);
  }, [unwrappedGiftWrapMessages, nostrKeys?.pubkey]);

  // `isSending` is React state — a rapid double-tap on the composer's send
  // button reads the stale `false` and lands twice into `handleNostrDMSend`,
  // publishing two NIP-17 gift-wraps and emitting two `pending-${Date.now()}`
  // optimistic bubbles (audit 33#F-005). Wrap the dispatch in single-flight
  // so the duplicate is dropped before either branch publishes.
  const handleSendMessage = useSingleFlight(async () => {
    if (!messageText.trim() || isSending) return;

    const text = messageText.trim();
    setMessageText('');

    chatLog.info('chat.send.dispatch', {
      surface: PERF_SURFACE,
      textLen: text.length,
      historyCount: messages.length,
    });

    await handleNostrDMSend(text);
  });

  const handleNostrDMSend = async (text: string) => {
    const dmStart = performance.now();
    log.info('dm.send.start', { messageLength: text.length, hasNdk: !!ndk, hasPubkey: !!pubkey });
    if (!ndk || !nostrKeys?.privateKey || !nostrKeys?.pubkey || !pubkey) {
      log.error('dm.send.missing_data', {
        hasNdk: !!ndk,
        hasPrivateKey: !!nostrKeys?.privateKey,
        hasPubkey: !!pubkey,
      });
      sendMessageFailedPopup();
      return;
    }

    setIsSending(true);
    const timestamp = Math.floor(Date.now() / 1000);
    const tempMessageId = `temp-${timestamp}`;

    const optimisticMessage: DmMessage = {
      id: tempMessageId,
      content: text,
      sender: 'me',
      timestamp: formatChatTimestamp(timestamp * 1000),
      isRead: false,
      isSending: true,
      created_at: timestamp,
      pubkey: nostrKeys.pubkey,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      // Build NIP-17 gift-wrapped DM pair: one for the recipient, one self-copy.
      // Both share the same rumor (with the counterparty in the `p` tag) per NIP-17.
      const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
        content: text,
        senderPrivateKey: nostrKeys.privateKey,
        recipientPublicKey: pubkey,
      });

      const wrapEvent = new NDKEvent(ndk);
      wrapEvent.kind = recipientWrap.kind;
      wrapEvent.content = recipientWrap.content;
      wrapEvent.tags = recipientWrap.tags;
      wrapEvent.created_at = recipientWrap.created_at;
      wrapEvent.pubkey = recipientWrap.pubkey;
      wrapEvent.id = recipientWrap.id;
      wrapEvent.sig = recipientWrap.sig;

      processedEventIds.current.add(wrapEvent.id);

      setMessages((prev) =>
        prev.map((msg) => (msg.id === tempMessageId ? { ...msg, id: wrapEvent.id } : msg))
      );

      await wrapEvent.publish();

      log.info('dm.send.published', {
        eventId: wrapEvent.id,
        duration_ms: Math.round(performance.now() - dmStart),
      });

      // Publish the self-copy so we can retrieve our own sent messages later.
      const selfWrapEvent = new NDKEvent(ndk);
      selfWrapEvent.kind = senderWrap.kind;
      selfWrapEvent.content = senderWrap.content;
      selfWrapEvent.tags = senderWrap.tags;
      selfWrapEvent.created_at = senderWrap.created_at;
      selfWrapEvent.pubkey = senderWrap.pubkey;
      selfWrapEvent.id = senderWrap.id;
      selfWrapEvent.sig = senderWrap.sig;

      processedEventIds.current.add(selfWrapEvent.id);

      await selfWrapEvent.publish().catch((err: unknown) => {
        log.warn('dm.send.self_copy_failed', { error: err });
      });

      log.info('dm.send.complete', {
        eventId: wrapEvent.id,
        total_ms: Math.round(performance.now() - dmStart),
      });

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === wrapEvent.id ? { ...msg, isRead: true, isSending: false } : msg
        )
      );
    } catch (error) {
      log.error('dm.send.failed', { error, total_ms: Math.round(performance.now() - dmStart) });
      setMessages((prev) => prev.filter((msg) => msg.id !== tempMessageId));
      sendMessageFailedPopup();
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMoney = () => {
    log.debug('user.messages.send_money', {
      lud16,
      userName: counterpartyMetadata?.name,
    });
    if (!lud16 || !counterpartyMetadata) return;

    // The amount screen's Next button now exposes an ecash/lightning/onchain
    // menu via coco-payment-ux amountEntry.next variants — so we skip the
    // upfront choice popup and let the user pick at Next time. We default
    // destination to sendEcash and pass meltTarget alongside so the Lightning
    // variant is enabled on arrival.
    const mint = useMintStore.getState().selectedMint ?? '';
    router.navigate({
      pathname: '/(send-flow)/amount',
      params: {
        amountEntry: JSON.stringify({
          destination: 'sendEcash',
          unit: 'sat',
          selectedMintUrl: mint,
          meltTarget: lud16,
        }),
      },
    });
  };

  const headerTitleWidth = screenWidth - 124 - 24;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}>
      <Log name="UserMessagesScreen">
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: false,
            headerStyle: { backgroundColor: surfaceSecondary },
            headerShadowVisible: false,
            headerBackVisible: false,
            headerTintColor: foreground,
            headerLeft: () => (
              <Pressable onPress={handleBack} style={{ padding: 8 }}>
                <Icon name="material-symbols:arrow-back-rounded" size={24} color={foreground} />
              </Pressable>
            ),
            headerTitle: () => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  width: headerTitleWidth,
                  height: 48,
                }}>
                <Avatar
                  state={shouldShowAvatarLoading ? 'loading' : userPicture ? 'image' : 'fallback'}
                  size={40}
                  picture={userPicture}
                  seed={pubkey}
                  name={displayName}
                />
                <VStack
                  spacing={2}
                  style={{
                    marginLeft: 8,
                    flex: 1,
                    minWidth: 0,
                    justifyContent: 'flex-start',
                    alignItems: 'flex-start',
                  }}>
                  <Text
                    loading={shouldShowAvatarLoading}
                    placeholder="Display Name"
                    size={16}
                    bold
                    style={{
                      color: foreground,
                      textAlign: 'left',
                    }}
                    numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text
                    size={12}
                    style={{
                      color: shade400,
                      marginTop: 2,
                      textAlign: 'left',
                    }}
                    numberOfLines={1}>
                    {truncateMiddle(nip19.npubEncode(pubkey), 8)}
                  </Text>
                </VStack>
              </View>
            ),
            headerRight: () => (
              <Pressable
                onPress={() =>
                  router.navigate({
                    pathname: '/share',
                    params: {
                      type: 'profile',
                      data: nip19.npubEncode(pubkey),
                    },
                  })
                }
                style={{ padding: 8 }}>
                <Icon name="stash:qr-code" size={20} color={foreground} />
              </Pressable>
            ),
          }}
        />
        <StatusBar barStyle="light-content" backgroundColor={surfaceSecondary} />
        <View style={{ flex: 1, backgroundColor: surface }}>
          {isLoading ? (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: 50,
              }}>
              <Text size={16} style={{ color: shade400 }}>
                Loading messages...
              </Text>
            </View>
          ) : (
            <LegendList
              ref={listRef}
              data={messages}
              onLayout={handleListLayout}
              onContentSizeChange={handleListContentSize}
              onScroll={handleListScroll}
              scrollEventThrottle={120}
              renderItem={({ item }: { item: DmMessage }) => (
                <MessageBubble
                  message={item}
                  isMe={item.sender === 'me'}
                  userPicture={item.sender === 'other' ? userPicture : undefined}
                  userName={displayName}
                  myName={myName}
                  isLoadingMetadata={shouldShowAvatarLoading}
                />
              )}
              keyExtractor={(item: DmMessage) => item.id}
              initialScrollAtEnd
              maintainScrollAtEnd
              maintainScrollAtEndThreshold={0.2}
              alignItemsAtEnd
              estimatedItemSize={80}
              recycleItems={false}
              style={{ flex: 1 }}
              contentContainerStyle={{
                padding: 16,
                paddingBottom: lud16 ? 70 : 16,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingTop: 50,
                  }}>
                  <Text size={16} style={{ color: shade400 }}>
                    No messages yet. Start the conversation!
                  </Text>
                </View>
              }
            />
          )}

          <View
            onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
            collapsable={false}>
            <ChatComposer
              value={messageText}
              onChangeText={setMessageText}
              onSend={handleSendMessage}
              disabled={isSending}
              placeholder="Type a message..."
              surface={PERF_SURFACE}
              leadingIconNode={
                <Avatar
                  state={myProfile.picture ? 'image' : 'fallback'}
                  size={32}
                  seed={nostrKeys?.pubkey}
                  picture={myProfile.picture}
                  name={myName}
                />
              }
            />
          </View>

          {/* Floating Send Money button — `composerHeight + 8` keeps the
              row 8pt above whatever the composer measures right now
              (single-line ≈ 96pt, multi-line grows). */}
          {composerHeight > 0 && lud16 && (
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                bottom: composerHeight + 8,
                left: 0,
                right: 0,
              }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  gap: 12,
                }}>
                <Button
                  variant="primary"
                  text="Send Money"
                  icon={<Icon name="mingcute:lightning-fill" size={20} color={surface} />}
                  onPress={handleSendMoney}
                  style={{ paddingHorizontal: 16 }}
                />
              </ScrollView>
            </View>
          )}
        </View>
      </Log>
    </KeyboardAvoidingView>
  );
}
