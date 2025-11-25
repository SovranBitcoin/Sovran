import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  ScrollView,
  Pressable,
  Platform,
  StatusBar,
  Dimensions,
  ColorValue,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { SheetManager } from 'react-native-actions-sheet';
import { nip19 } from 'nostr-tools';
import {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKUser,
  useNDK,
  useSubscribe,
} from '@nostr-dev-kit/ndk-mobile';
import { Metadata, EncryptedDirectMessage } from 'nostr-tools/kinds';
import { LegendList } from '@legendapp/list';

// Custom hooks and providers
import { Message } from 'redux/nostr';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

// Components
import { View, VStack, HStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import TextInput from 'components/ui/TextInput';
import Icon from 'assets/icons';
import { SessionsPanel } from 'components/blocks/routstr/SessionsPanel';
import {
  ContextMenu,
  Host,
  Button,
  BottomSheet,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
  HStack as SwiftUIHStack,
} from '@expo/ui/swift-ui';

// Utilities
import { maybeConvertNpub, isValidEcashToken } from '@/helper/coco/utils';
import { withSheetProvider } from '@/hocs/withSheetProvider';
import { ROUTSTR_PUBKEY } from 'helper/constants';
import { useRoutstrStore } from 'stores/routstrStore';
import { checkBalance, sendMessage, getModels, RoutstrModel } from 'helper/routstr/api';
import { popup } from '@/helper/popup';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import { Proof } from '@cashu/cashu-ts';
import { formatAmount } from 'helper/currency';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { LinearGradient } from 'expo-linear-gradient';
import {
  foregroundStyle,
  frame,
  padding,
  background,
  cornerRadius,
  fixedSize,
} from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';
import { truncateMiddle } from '@/helper/strings';

export type TimelineItemType = Message;

// ===========================
// UTILITY FUNCTIONS
// ===========================

export function convertNpub(pubkey: string) {
  try {
    const npub = nip19.decode(pubkey);
    if (npub?.type === 'npub') return maybeConvertNpub(pubkey)?.slice(2);
  } catch {
    return pubkey;
  }
  return maybeConvertNpub(pubkey)?.slice(2);
}

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

function formatBalance(msats: number | null): string {
  if (msats === null) return 'Unknown';
  if (msats >= 1000) {
    return `${(msats / 1000).toFixed(0)} sats`;
  }
  return `${msats} msats`;
}

function formatModelPrice(model: RoutstrModel): string {
  const maxCost = model.sats_pricing.max_cost;
  if (maxCost === 0) return 'Free';
  const sats = Math.round(maxCost / 1000);
  return `${sats} sats`;
}

function extractProviderFromSlug(canonicalSlug: string): string {
  const parts = canonicalSlug.split('/');
  const provider = parts[0] || 'Unknown';
  // Capitalize first letter
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function extractModelName(model: RoutstrModel): { provider: string; modelName: string } {
  // Try to extract from canonical_slug first (e.g., "openai/gpt-5.1-20251113")
  const provider = extractProviderFromSlug(model.canonical_slug);

  // Extract model name from canonical_slug (remove provider prefix and date)
  const slugParts = model.canonical_slug.split('/');
  let modelName = slugParts[1] || model.name;

  // Remove date suffix if present (e.g., "-20251113")
  modelName = modelName.replace(/-\d{8}$/, '');

  // If name already includes provider prefix (e.g., "OpenAI: GPT-5.1"), extract just the model part
  if (model.name.includes(':')) {
    const nameParts = model.name.split(':');
    if (nameParts.length > 1) {
      modelName = nameParts[1].trim();
    }
  } else {
    // Fallback to the name as-is
    modelName = model.name;
  }

  return { provider, modelName };
}

function getProviderIcon(provider: string): string {
  const providerLower = provider.toLowerCase();
  // Map common providers to available icons
  const iconMap: Record<string, string> = {
    openai: 'ri:openai-fill',
    anthropic: 'ri:anthropic-fill',
    'anthracite-org': 'ri:robot',
    google: 'ri:google-fill',
    meta: 'ri:meta-fill',
    mistralai: 'simple-icons:mistralai',
    cohere: 'mdi:robot',
    perplexity: 'ri:perplexity-line',
    nvidia: 'bi:nvidia',
    qwen: 'hugeicons:qwen',
    deepseek: 'ri:deepseek-fill',
    alibaba: 'ant-design:alibaba-outlined',
    'x-ai': 'ri:twitter-x-fill',
    amazon: 'ri:amazon-fill',
    ibm: 'cib:ibm',
    'ibm-granite': 'cib:ibm',
    // Well-known brands with available icons
    microsoft: 'simple-icons:microsoft',
    baidu: 'simple-icons:baidu',
    tencent: 'simple-icons:tencentqq',
    bytedance: 'simple-icons:tiktok',
    // AI/ML companies - using robot/brain icons as fallbacks
    ai21: 'mdi:brain',
    inflection: 'mdi:brain',
    eleutherai: 'mdi:brain',
    moonshotai: 'mdi:brain',
    minimax: 'mdi:brain',
    'stepfun-ai': 'mdi:brain',
    thudm: 'mdi:brain',
    nousresearch: 'mdi:brain',
    nous: 'mdi:brain',
    allenai: 'mdi:brain',
    // Lesser-known brands - using robot icon as fallback
    'agentica-ai': 'mdi:robot',
    'aion-labs': 'mdi:robot',
    alfredpros: 'mdi:robot',
    'arcee-ai': 'mdi:robot',
    arliai: 'mdi:robot',
    'deep cogito': 'mdi:robot',
    deepcogito: 'mdi:robot',
    inception: 'mdi:robot',
    mancer: 'mdi:robot',
    meituan: 'mdi:robot',
    morph: 'mdi:robot',
    neversleep: 'mdi:robot',
    opengvlab: 'mdi:robot',
    relace: 'mdi:robot',
    sao10k: 'mdi:robot',
    'shisa ai': 'mdi:robot',
    shisaai: 'mdi:robot',
    tng: 'mdi:robot',
    thedrummer: 'mdi:robot',
    'z-ai': 'mdi:robot',
    inclusionai: 'mdi:robot',
    unknown: 'mdi:help-circle',
  };
  return iconMap[providerLower] || 'mdi:robot';
}

/**
 * Extracts a cashu token from message content
 * Looks for tokens starting with "cashuA" or "cashuB" and validates them
 */
function extractCashuToken(content: string): string | null {
  if (!content || typeof content !== 'string') return null;

  // Find the index of cashuA or cashuB (case insensitive)
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

  // Extract token starting from the found index
  // Tokens are base64 encoded and can be quite long, so we'll try to extract
  // a reasonable length. Cashu tokens are typically several hundred characters
  const remainingText = content.slice(tokenStartIndex);

  // Try to find where the token ends (it might be followed by whitespace or end of string)
  // We'll validate progressively longer substrings
  let token = '';
  const maxTokenLength = 5000; // Reasonable upper bound for cashu tokens

  for (let i = 6; i <= Math.min(remainingText.length, maxTokenLength); i++) {
    const candidate = remainingText.slice(0, i);
    if (isValidEcashToken(candidate)) {
      token = candidate;
    } else if (token) {
      // We found a valid token but the next character breaks it, so return what we have
      break;
    }

    // If we hit whitespace or newline and haven't found a valid token yet, stop
    if (/\s/.test(remainingText[i]) && !token) {
      break;
    }
  }

  return token || null;
}

// ===========================
// COMPONENTS
// ===========================

interface CashuTokenBubbleProps {
  token: string;
  isMe: boolean;
}

/**
 * Component to display a cashu token as a separate bubble
 * Shows amount, USD value, and action button (Redeem/Cancel)
 */
function CashuTokenBubble({ token, isMe }: CashuTokenBubbleProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();

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
    console.error('Failed to decode cashu token:', error);
    isValid = false;
  }

  // Convert amount to USD
  const usdAmount = isValid
    ? formatAmount({ amount, unit }, { displayAs: 'usd', currencyDisplay: 'symbol' })
    : '';

  const handlePress = () => {
    if (!isValid) {
      popup({
        message: 'Invalid token',
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    // Create receive history entry
    const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
      id: `receive-${Date.now()}`,
      type: 'receive',
      amount,
      unit,
      mintUrl,
      createdAt: Date.now(),
      metadata: {},
      token,
    };

    router.push({
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
    ? [getShadeColor('200'), getShadeColor('300')]
    : [getPrimaryColor('600'), getPrimaryColor('700')];

  const innerGradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isMe
    ? [opacity(getPrimaryColor('0'), 0.2), opacity(getPrimaryColor('0'), 0.175)]
    : [getPrimaryColor('800'), getPrimaryColor('900')];

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
            {/* Mint URL */}
            {mintUrl && (
              <Text
                size={12}
                style={{
                  color: getPrimaryColor('0'),
                  opacity: 0.75,
                }}>
                {mintUrl}
              </Text>
            )}

            {/* Amount */}
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
                  color={getPrimaryColor('0')}
                />
                {usdAmount && (
                  <Text
                    size={14}
                    style={{
                      color: getPrimaryColor('0'),
                      opacity: 0.9,
                    }}>
                    {usdAmount}
                  </Text>
                )}
              </VStack>
            </LinearGradient>

            {/* Action Button */}
            <Pressable
              onPress={handlePress}
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 16,
                backgroundColor: getPrimaryColor('0'),
                borderRadius: 8,
                alignItems: 'center',
              }}>
              <HStack align="center" spacing={6}>
                {!isMe && (
                  <Icon
                    name="material-symbols:arrow-downward"
                    size={16}
                    color={getPrimaryColor('600')}
                  />
                )}
                <Text
                  size={14}
                  bold
                  style={{
                    color: getPrimaryColor('600'),
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
  message: any;
  isMe: boolean;
  userPicture?: string;
  isLoadingMetadata?: boolean;
  isStreaming?: boolean;
}

// Helper function to detect placeholder text patterns
function isPlaceholderText(content: string): boolean {
  if (!content || content.length === 0) return true;

  // Very short content (< 10 chars) might be placeholder
  if (content.length < 10) {
    const trimmed = content.trim().toLowerCase();
    // Common placeholder patterns
    const placeholderPatterns = [
      '...',
      'processing...',
      'thinking...',
      'generating...',
      'loading...',
      'please wait...',
    ];
    return placeholderPatterns.some(
      (pattern) => trimmed === pattern || trimmed.startsWith(pattern)
    );
  }

  return false;
}

function MessageBubble({
  message,
  isMe,
  userPicture,
  isLoadingMetadata,
  isStreaming,
}: MessageBubbleProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();

  const content = Array.isArray(message.content)
    ? message.content.join('')
    : typeof message.content === 'string'
      ? message.content
      : String(message.content || '');

  // Check if stream is complete (from message object or prop)
  const isStreamComplete = message.isStreamComplete !== undefined ? message.isStreamComplete : true;

  // Determine if we should show skeleton:
  // - Stream is active (isStreaming && !isStreamComplete)
  // - Content is empty or looks like placeholder
  const shouldShowSkeleton =
    isStreaming && !isStreamComplete && (content.length === 0 || isPlaceholderText(content));

  // Extract cashu token from content
  const cashuToken = extractCashuToken(content);

  // Remove token from displayed content if found
  let displayContent = content;
  if (cashuToken && !shouldShowSkeleton) {
    displayContent = content.replace(cashuToken, '').trim();
    // If content is empty after removing token, don't show the text bubble
    if (!displayContent) {
      displayContent = '';
    }
  }

  // Show skeleton for placeholder text, otherwise show actual content
  if (!shouldShowSkeleton && displayContent === '' && cashuToken) {
    // If we only have a token and no other content, skip the text bubble
    displayContent = '';
  } else {
    displayContent = shouldShowSkeleton ? '' : displayContent;
  }

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
            size={32}
            picture={userPicture}
            seed={message.pubkey}
            name={message.sender === 'other' ? 'Other User' : 'Me'}
            loading={isLoadingMetadata}
          />
        )}

        <VStack
          align={isMe ? 'flex-end' : 'flex-start'}
          spacing={4}
          style={{ flex: 1, maxWidth: '85%' }}>
          {/* Only show text bubble if there's content to display */}
          {(displayContent || shouldShowSkeleton) && (
            <View
              style={{
                backgroundColor: isMe ? getPrimaryColor('600') : getPrimaryColor('700'),
                borderRadius: 18,
                borderTopLeftRadius: isMe ? 18 : 4,
                borderTopRightRadius: isMe ? 4 : 18,
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                minHeight: shouldShowSkeleton ? 44 : undefined, // Ensure skeleton has space
                minWidth: shouldShowSkeleton ? 60 : undefined,
              }}>
              {shouldShowSkeleton ? (
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                  }}>
                  <View
                    style={{
                      width: 60,
                      height: 16,
                      backgroundColor: getPrimaryColor('600'),
                      borderRadius: 8,
                      opacity: 0.6,
                    }}
                  />
                </View>
              ) : (
                <Text
                  size={16}
                  style={{
                    color: getPrimaryColor('0'),
                    lineHeight: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}>
                  {displayContent}
                </Text>
              )}
            </View>
          )}

          {/* Cashu Token Bubble */}
          {cashuToken && <CashuTokenBubble token={cashuToken} isMe={isMe} />}

          <HStack align="center" spacing={4}>
            <Text
              size={12}
              style={{
                color: getShadeColor('400'),
                marginLeft: isMe ? 0 : 8,
              }}>
              {message.timestamp}
            </Text>
            {isMe &&
              (message.isSending ? (
                <Icon name="svg-spinners:90-ring-with-bg" size={14} color={getShadeColor('500')} />
              ) : (
                <Icon
                  name={message.isRead ? 'ion:checkmark-done' : 'simple-line-icons:check'}
                  size={14}
                  color={message.isRead ? getPrimaryColor('400') : getShadeColor('500')}
                />
              ))}
          </HStack>
        </VStack>

        {isMe && <Avatar size={32} seed={message.pubkey} name="Me" loading={false} />}
      </HStack>
    </VStack>
  );
}

// ===========================
// MODEL LIST ITEM COMPONENT
// ===========================
interface ModelListItemProps {
  model: RoutstrModel;
  isSelected: boolean;
  onSelect: (modelId: string) => void;
}

const ModelListItem = React.memo(({ model, onSelect }: ModelListItemProps) => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const { provider, modelName } = extractModelName(model);
  const price = formatModelPrice(model);

  const modality = model.architecture?.modality || 'text->text';
  const pricePerToken = model.sats_pricing?.completion || 0;
  const minAmount = Math.ceil(model.sats_pricing?.max_cost || 0);
  const tokensPerSat = pricePerToken > 0 ? Math.round(1 / pricePerToken) : 0;

  return (
    <Host matchContents={false} fixedSize={true} style={{ height: 96 }}>
      <Button
        variant="plain"
        modifiers={[
          frame({
            height: 96,
            width: Dimensions.get('window').width - 32,
            alignment: 'leading',
          }),
          padding({ all: 0 }), // Remove padding from button
        ]}
        onPress={() => {
          console.log('Pressed model:', model.id);
          onSelect(model.id);
        }}>
        <SwiftUIHStack
          alignment="center"
          spacing={12}
          modifiers={[
            frame({
              width: Dimensions.get('window').width,
              height: 96,
              alignment: 'leading',
            }),
            // padding({ horizontal: 16, vertical: 16 }),
          ]}>
          {/* Icon with fixed width */}
          <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 24, height: 24 })]}>
            <Icon name={getProviderIcon(provider)} size={24} color={getPrimaryColor('0')} />
          </SwiftUIVStack>

          {/* Content VStack that fills remaining space */}
          <SwiftUIVStack
            spacing={4}
            alignment="leading"
            modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SwiftUIText
              size={16}
              weight="semibold"
              modifiers={[foregroundStyle(getPrimaryColor('0'))]}>
              {modelName}
            </SwiftUIText>
            <SwiftUIText size={14} modifiers={[foregroundStyle(getShadeColor('400'))]}>
              {provider}
            </SwiftUIText>
            <SwiftUIHStack alignment="center" spacing={8}>
              <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 16, height: 16 })]}>
                <Icon
                  name={'material-symbols:account-balance-wallet'}
                  size={16}
                  color={getPrimaryColor('0')}
                />
              </SwiftUIVStack>
              <SwiftUIText size={12} modifiers={[foregroundStyle(getShadeColor('400'))]}>
                {`${minAmount} sats`}
              </SwiftUIText>
              <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 16, height: 16 })]}>
                <Icon name={'solar:tag-price-bold'} size={16} color={getPrimaryColor('0')} />
              </SwiftUIVStack>
              <SwiftUIText size={12} modifiers={[foregroundStyle(getShadeColor('400'))]}>
                {tokensPerSat > 0 ? `${tokensPerSat.toLocaleString()} tok/sat` : 'Free'}
              </SwiftUIText>
            </SwiftUIHStack>
          </SwiftUIVStack>
        </SwiftUIHStack>
      </Button>
    </Host>
  );
});

ModelListItem.displayName = 'ModelListItem';

// ===========================
// MAIN COMPONENT
// ===========================

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingMessageRef = useRef<string | null>(null);

  const { getPrimaryColor, getShadeColor } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();
  const { ndk } = useNDK();

  // ===========================
  // STATE
  // ===========================
  const [messages, setMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [isAttachmentsBottomSheetOpen, setIsAttachmentsBottomSheetOpen] = useState(false);
  const [isModelSwitchBottomSheetOpen, setIsModelSwitchBottomSheetOpen] = useState(false);
  const [isSessionsPanelOpen, setIsSessionsPanelOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<RoutstrModel[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  // Routstr mode detection
  const isRoutstrMode = pubkey === ROUTSTR_PUBKEY;

  // Calculate minimum bottom sheet detent (50% or 500px, whichever is larger)
  const bottomSheetDetents = useMemo((): ('medium' | 'large' | number)[] => {
    const screenHeight = Dimensions.get('window').height;
    const minHeight = Math.max(screenHeight * 0.5, 500);
    const minFraction = minHeight / screenHeight;
    return [minFraction, 'large'];
  }, []);

  // ===========================
  // ROUTSTR STORE
  // ===========================
  const {
    balance,
    setBalance,
    setApiKey,
    addMessage,
    getConversationHistory,
    updateMessage,
    clearConversation,
    getSelectedModel,
    createSession,
    switchSession,
    getCurrentSessionId,
    getAllSessions,
    updateCurrentSessionTitle,
    setAnonymousMode,
    getAnonymousMode,
    getCachedModels,
    setCachedModels,
    setSelectedModel,
  } = useRoutstrStore();
  const apiKey = 'sk-15dbf6b51cd389246da366c26499bde801c04795b372b8c4ff0241e3bbe3120c';

  // ===========================
  // NOSTR SUBSCRIPTIONS
  // ===========================
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

  const dmFilters = useMemo(() => {
    if (isRoutstrMode || !nostrKeys?.pubkey) return null;

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
  }, [pubkey, nostrKeys?.pubkey, isRoutstrMode]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // ===========================
  // DERIVED STATE
  // ===========================
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = isRoutstrMode
    ? userInfo?.display_name || userInfo?.name || 'routstr'
    : userInfo?.display_name || userInfo?.name || 'Unknown User';
  const userPicture = userInfo?.picture;
  const lud16 = userInfo?.lud16;
  const isMetadataLoading = !metadataEose;
  const shouldShowAvatarLoading = !isRoutstrMode && isMetadataLoading && !userInfo;

  // Get unique providers from available models
  const uniqueProviders = useMemo(() => {
    return availableModels.reduce((acc: string[], model: RoutstrModel) => {
      const { provider } = extractModelName(model);
      if (!acc.includes(provider)) {
        acc.push(provider);
      }
      return acc;
    }, []);
  }, [availableModels]);

  // Filter models by selected provider
  const filteredModels = useMemo(() => {
    if (!selectedProvider) return availableModels;
    return availableModels.filter((model) => {
      const { provider } = extractModelName(model);
      return provider === selectedProvider;
    });
  }, [availableModels, selectedProvider]);

  // Get selected model name
  const selectedModelName = useMemo(() => {
    if (!isRoutstrMode) return null;
    const selectedModelId = getSelectedModel();
    const model = availableModels.find((m) => m.id === selectedModelId);
    if (!model) return selectedModelId;
    const { modelName } = extractModelName(model);
    return modelName;
  }, [isRoutstrMode, availableModels, getSelectedModel]);

  // ===========================
  // EFFECTS
  // ===========================

  // Initialize Routstr
  useEffect(() => {
    if (!isRoutstrMode) return;

    const initRoutstr = async () => {
      setIsLoading(true);
      try {
        // Ensure we have a current session
        if (!getCurrentSessionId()) {
          const sessions = getAllSessions();
          if (sessions.length > 0) {
            switchSession(sessions[0].id);
          } else {
            createSession();
          }
        }

        // Load conversation history
        const history = getConversationHistory();
        const formattedMessages = history.map((msg) => ({
          id: msg.id,
          content: msg.content,
          sender: msg.role === 'user' ? 'me' : 'other',
          timestamp: formatTimestamp(msg.timestamp),
          isRead: true,
          created_at: msg.timestamp,
          pubkey: msg.role === 'user' ? nostrKeys?.pubkey || 'me' : ROUTSTR_PUBKEY,
        }));
        setMessages(formattedMessages);

        // Check balance if API key exists
        if (apiKey) {
          try {
            const balanceData = await checkBalance(apiKey);
            if (balanceData.api_key && balanceData.api_key !== apiKey) {
              setApiKey(balanceData.api_key);
            }
            setBalance(balanceData.balance);
          } catch (error) {
            console.error('Failed to check balance:', error);
          }

          // Load models
          await loadModels();
        }
      } catch (error) {
        console.error('Error initializing Routstr:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initRoutstr();
  }, [isRoutstrMode, apiKey, nostrKeys?.pubkey]);

  // Load models when API key becomes available
  useEffect(() => {
    if (!isRoutstrMode || !apiKey || availableModels.length > 0) return;
    loadModels();
  }, [isRoutstrMode, apiKey, availableModels.length]);

  // Listen for session changes
  useEffect(() => {
    if (!isRoutstrMode) return;

    const history = getConversationHistory();
    const formattedMessages = history.map((msg) => ({
      id: msg.id,
      content: msg.content,
      sender: msg.role === 'user' ? 'me' : 'other',
      timestamp: formatTimestamp(msg.timestamp),
      isRead: true,
      created_at: msg.timestamp,
      pubkey: msg.role === 'user' ? nostrKeys?.pubkey || 'me' : ROUTSTR_PUBKEY,
    }));
    setMessages(formattedMessages);
  }, [isRoutstrMode, getCurrentSessionId(), nostrKeys?.pubkey]);

  // Track processed event IDs to avoid re-processing
  const processedEventIds = useRef<Set<string>>(new Set());

  // Reset processed events when conversation changes
  useEffect(() => {
    processedEventIds.current.clear();
    setMessages([]);
    setIsLoading(true);
  }, [pubkey]);

  // Process DM events
  useEffect(() => {
    if (isRoutstrMode) return;

    const processDMs = async () => {
      // Need pubkey (counterparty), nostrKeys.pubkey, and nostrKeys.privateKey for decryption
      if (!dmEvents || !nostrKeys?.pubkey || !nostrKeys?.privateKey || !pubkey) {
        setIsLoading(false);
        return;
      }

      // If no events yet, just wait
      if (dmEvents.length === 0) {
        setIsLoading(false);
        return;
      }

      try {
        // Find events that haven't been processed yet
        const newEvents = dmEvents.filter((event) => !processedEventIds.current.has(event.id));

        // If no new events, just ensure loading is false
        if (newEvents.length === 0) {
          setIsLoading(false);
          return;
        }

        const processedMessages = await Promise.all(
          newEvents.map(async (event) => {
            try {
              // Use pubkey (the counterparty from route params) not event.pubkey
              // because event.pubkey could be our own pubkey if we sent it
              const counterparty = new NDKUser({ pubkey: pubkey });
              const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);
              await event.decrypt(counterparty, signer);
              const isMe = event.pubkey === nostrKeys.pubkey;
              const senderPubkey = isMe ? nostrKeys.pubkey : event.pubkey;

              // Mark as processed
              processedEventIds.current.add(event.id);

              return {
                id: event.id,
                content: event.content,
                sender: isMe ? 'me' : 'other',
                timestamp: formatTimestamp(event.created_at || 0),
                isRead: true,
                created_at: event.created_at || 0,
                pubkey: senderPubkey,
              };
            } catch (error) {
              console.error('Failed to decrypt message:', error);
              // Still mark as processed to avoid retrying failed decryptions
              processedEventIds.current.add(event.id);
              return null;
            }
          })
        );

        const validNewMessages = processedMessages.filter(
          (msg): msg is NonNullable<typeof msg> => msg !== null
        );

        // Merge new messages with existing ones (avoiding duplicates) and sort
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          // Also create a set of content+timestamp combinations to catch optimistic messages
          // that might still have temp IDs
          const existingContentKeys = new Set(
            prev.map((m) => `${m.content}-${m.created_at}-${m.sender}`)
          );

          const uniqueNewMessages = validNewMessages.filter((m) => {
            // Skip if ID already exists
            if (existingIds.has(m.id)) return false;
            // Skip if content+timestamp+sender combination already exists (optimistic message)
            const contentKey = `${m.content}-${m.created_at}-${m.sender}`;
            if (existingContentKeys.has(contentKey)) return false;
            return true;
          });

          const merged = [...prev, ...uniqueNewMessages];
          return merged.sort((a, b) => a.created_at - b.created_at);
        });
      } catch (error) {
        console.error('Error processing DMs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    processDMs();
  }, [dmEvents, nostrKeys?.pubkey, nostrKeys?.privateKey, pubkey, isRoutstrMode]);

  // ===========================
  // HANDLERS
  // ===========================

  const loadModels = async () => {
    if (!apiKey) return;

    try {
      const cached = getCachedModels();
      if (cached && cached.length > 0) {
        console.log('Using cached models:', cached);
        setAvailableModels(cached);
      } else {
        console.log('Fetching models from API...');
        const models = await getModels(apiKey);
        console.log('Loaded models:', models.length);
        if (models && models.length > 0) {
          setCachedModels(models);
          setAvailableModels(models);
        }
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const handleRefreshBalance = async () => {
    if (!apiKey || isRefreshingBalance) return;

    setIsRefreshingBalance(true);
    try {
      const balanceData = await checkBalance(apiKey);
      if (balanceData.api_key && balanceData.api_key !== apiKey) {
        setApiKey(balanceData.api_key);
      }
      setBalance(balanceData.balance);
      popup({
        message: `Balance refreshed: ${formatBalance(balanceData.balance)}`,
        emoji: '✅',
        type: 'success',
      });
    } catch (error: any) {
      console.error('Failed to refresh balance:', error);
      popup({
        message: error.error?.message || 'Failed to refresh balance',
        emoji: '🚨',
        type: 'error',
      });
    } finally {
      setIsRefreshingBalance(false);
    }
  };

  const handleTopUp = async () => {
    if (!nostrKeys?.pubkey) {
      popup({ message: 'No wallet available', emoji: '🚨', type: 'error' });
      return;
    }

    router.push({
      pathname: '/currency',
      params: {
        to: 'sendToken',
        routstrTopUp: 'true',
      },
    });
  };

  const handleRoutstrSend = async (userMessage: string) => {
    if (!apiKey) {
      popup({
        message: 'No API key configured. Please set up your Routstr API key.',
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    const isAnonymous = getAnonymousMode();

    // Ensure we have a current session (only if not anonymous)
    if (!isAnonymous) {
      let currentSessionId = getCurrentSessionId();
      if (!currentSessionId) {
        currentSessionId = createSession();
      }
    }

    setIsSending(true);
    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    // Add user message
    const userMsg = {
      id: userMessageId,
      role: 'user' as const,
      content: userMessage,
      timestamp,
    };

    if (!isAnonymous) {
      addMessage(userMsg);
      const history = getConversationHistory();
      const isFirstUserMessage = history.filter((msg) => msg.role === 'user').length === 0;
      if (isFirstUserMessage) {
        setTimeout(() => updateCurrentSessionTitle(), 100);
      }
    }

    const userMessageDisplay = {
      id: userMessageId,
      content: userMessage,
      sender: 'me' as const,
      timestamp: formatTimestamp(timestamp),
      isRead: true,
      created_at: timestamp,
      pubkey: nostrKeys?.pubkey || 'me',
    };
    setMessages((prev) => [...prev, userMessageDisplay]);

    // Add placeholder for assistant response
    const assistantMsg = {
      id: assistantMessageId,
      role: 'assistant' as const,
      content: '',
      timestamp: timestamp + 1,
    };

    if (!isAnonymous) {
      addMessage(assistantMsg);
    }

    const assistantMessageDisplay = {
      id: assistantMessageId,
      content: '',
      sender: 'other' as const,
      timestamp: formatTimestamp(timestamp + 1),
      isRead: true,
      created_at: timestamp + 1,
      pubkey: ROUTSTR_PUBKEY,
    };
    setMessages((prev) => [...prev, assistantMessageDisplay]);

    // Mark as streaming immediately so bubble shows with loading state
    setStreamingMessageId(assistantMessageId);

    // Scroll to bottom to show the new assistant bubble
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      // Build conversation history
      let apiMessages: { role: 'user' | 'assistant' | 'system'; content: string }[];
      if (isAnonymous) {
        const history = messages
          .filter((msg) => msg.sender === 'me' || msg.pubkey === ROUTSTR_PUBKEY)
          .map((msg) => ({
            role: (msg.sender === 'me' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: msg.content || '',
            id: msg.id,
            timestamp: msg.created_at,
          }));
        history.push({
          role: 'user' as const,
          content: userMessage,
          id: userMessageId,
          timestamp,
        });
        apiMessages = history
          .filter((msg) => msg.id !== assistantMessageId)
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));
      } else {
        const history = getConversationHistory();
        apiMessages = history
          .filter((msg) => msg.id !== assistantMessageId)
          .map((msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          }));
      }

      // Send message with streaming
      const selectedModel = getSelectedModel();
      const { stream } = await sendMessage(apiKey, apiMessages, {
        model: selectedModel,
        temperature: 0.7,
        max_tokens: 200,
        stream: true,
      });

      if (!stream) {
        throw new Error('Stream not available');
      }

      // Process streaming response - update immediately as chunks arrive
      let fullContent = '';
      let chunkCount = 0;
      let hasReceivedAnyContent = false;
      let isStreamComplete = false;

      for await (const chunk of stream) {
        chunkCount++;

        // Check finish_reason to determine if stream is complete
        // finish_reason is null/undefined while streaming, has value when complete
        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason !== null && finishReason !== undefined) {
          isStreamComplete = true;
        }

        // Try multiple possible content locations (different API versions might structure differently)
        const delta = chunk.choices?.[0]?.delta;
        const content =
          delta?.content || (delta as any)?.message?.content || (delta as any)?.text || null;

        // Log first few chunks for debugging
        if (chunkCount <= 5) {
          console.log('Stream chunk:', {
            chunkCount,
            hasContent: !!content,
            contentLength: content?.length,
            contentPreview: content?.substring(0, 30),
            finishReason,
            isStreamComplete,
            chunkStructure: {
              hasChoices: !!chunk.choices,
              choicesLength: chunk.choices?.length,
              hasDelta: !!chunk.choices?.[0]?.delta,
              deltaKeys: chunk.choices?.[0]?.delta ? Object.keys(chunk.choices[0].delta) : [],
            },
          });
        }

        if (content) {
          hasReceivedAnyContent = true;
          fullContent += content;

          // Update state immediately without batching - React will batch these automatically
          if (!isAnonymous) {
            updateMessage(assistantMessageId, fullContent);
          }

          // Update messages state immediately for UI - include stream completion status
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: fullContent, isStreamComplete }
                : msg
            )
          );

          // Scroll to bottom periodically (not on every chunk to avoid performance issues)
          // Scroll more frequently for short messages, less for long ones
          if (fullContent.length < 100 || fullContent.length % 100 === 0) {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }
        } else if (isStreamComplete) {
          // Even if no content in this chunk, update completion status
          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, isStreamComplete } : msg))
          );
        }
      }

      // Mark stream as complete after loop ends
      isStreamComplete = true;

      console.log('Streaming completed:', {
        totalChunks: chunkCount,
        finalContentLength: fullContent.length,
        hasReceivedAnyContent,
        isStreamComplete,
      });

      // Final update after streaming completes - ensure isStreamComplete is set
      if (!isAnonymous && fullContent) {
        updateMessage(assistantMessageId, fullContent);
      }

      // Final state update with completion status
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: fullContent, isStreamComplete: true }
            : msg
        )
      );

      // Always clear streaming state, but log warning if no content
      setStreamingMessageId(null);

      if (!hasReceivedAnyContent && chunkCount > 0) {
        console.warn('No content received from stream after', chunkCount, 'chunks');
        // Update message to show error or empty state
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: fullContent || '(No response received)' }
              : msg
          )
        );
      }

      // Final scroll
      scrollViewRef.current?.scrollToEnd({ animated: true });

      // Refresh balance
      try {
        const balanceData = await checkBalance(apiKey);
        setBalance(balanceData.balance);
      } catch (error) {
        console.error('Failed to refresh balance:', error);
      }
    } catch (error: any) {
      // Handle insufficient balance
      if (error.status === 402) {
        const required = error.error?.details?.required || 0;
        const available = error.error?.details?.available || 0;
        const needed = Math.ceil((required - available) / 1000);

        setMessages((prev) =>
          prev.filter((msg) => msg.id !== userMessageId && msg.id !== assistantMessageId)
        );

        if (!isAnonymous) {
          const currentHistory = getConversationHistory();
          clearConversation();
          currentHistory
            .filter((msg: any) => msg.id !== userMessageId && msg.id !== assistantMessageId)
            .forEach((msg: any) => addMessage(msg));
        }

        popup({
          message: `Insufficient balance. Need ${needed} sats to continue.`,
          emoji: '💰',
          type: 'warning',
          buttons: [
            {
              text: 'Top Up',
              onPress: async () => {
                pendingMessageRef.current = userMessage;
                await handleTopUp();
              },
            },
            {
              text: 'Cancel',
              onPress: () => {},
            },
          ],
        });
        return;
      }

      console.error('Error sending message:', error);
      popup({
        message: error.error?.message || 'Failed to send message',
        emoji: '🚨',
        type: 'error',
      });

      // Clear streaming state on error
      setStreamingMessageId(null);

      setMessages((prev) =>
        prev.filter((msg) => msg.id !== userMessageId && msg.id !== assistantMessageId)
      );

      const currentHistory = getConversationHistory();
      clearConversation();
      currentHistory
        .filter((msg: any) => msg.id !== userMessageId && msg.id !== assistantMessageId)
        .forEach((msg: any) => addMessage(msg));
    } finally {
      setIsSending(false);
      // Ensure streaming state is cleared
      setStreamingMessageId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || isSending) return;

    const text = messageText.trim();
    setMessageText('');

    if (isRoutstrMode) {
      await handleRoutstrSend(text);
    } else {
      // Send Nostr DM
      await handleNostrDMSend(text);
    }
  };

  const handleNostrDMSend = async (text: string) => {
    if (!ndk || !nostrKeys?.privateKey || !nostrKeys?.pubkey || !pubkey) {
      console.error('Missing required data for sending DM');
      popup({
        message: 'Unable to send message. Please try again.',
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    setIsSending(true);
    const timestamp = Math.floor(Date.now() / 1000);
    const tempMessageId = `temp-${timestamp}`;

    // Optimistically add the message to the UI with isSending flag
    const optimisticMessage = {
      id: tempMessageId,
      content: text,
      sender: 'me' as const,
      timestamp: formatTimestamp(timestamp),
      isRead: false,
      isSending: true, // Show spinner while sending
      created_at: timestamp,
      pubkey: nostrKeys.pubkey,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // Scroll to bottom
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      // Create the DM event
      const dmEvent = new NDKEvent(ndk);
      dmEvent.kind = EncryptedDirectMessage;
      dmEvent.content = text;
      dmEvent.tags = [['p', pubkey]];

      // Create signer and recipient for encryption
      const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);
      const recipient = new NDKUser({ pubkey: pubkey });

      // Encrypt the message
      await dmEvent.encrypt(recipient, signer);

      // Sign the event (this generates the event ID)
      await dmEvent.sign(signer);

      // Mark this event as processed BEFORE publishing to prevent race condition
      // where subscription receives the event before we can mark it as processed
      processedEventIds.current.add(dmEvent.id);

      // Update the optimistic message with the real ID BEFORE publishing
      // This ensures the ID is in place when the subscription receives the event
      setMessages((prev) =>
        prev.map((msg) => (msg.id === tempMessageId ? { ...msg, id: dmEvent.id } : msg))
      );

      // Publish the event
      await dmEvent.publish();

      console.log('DM sent successfully:', dmEvent.id);

      // Mark as sent (not sending anymore)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === dmEvent.id ? { ...msg, isRead: true, isSending: false } : msg
        )
      );
    } catch (error) {
      console.error('Failed to send DM:', error);

      // Remove the optimistic message on failure
      setMessages((prev) => prev.filter((msg) => msg.id !== tempMessageId));

      popup({
        message: 'Failed to send message. Please try again.',
        emoji: '🚨',
        type: 'error',
      });
    } finally {
      setIsSending(false);
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

  // Model selection handler with proper types
  const handleModelSelect = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      setIsModelSwitchBottomSheetOpen(false);
      const selectedModelName = availableModels.find((m) => m.id === modelId)?.name || modelId;
      popup({
        message: `Switched to ${selectedModelName}`,
        emoji: '🤖',
        type: 'success',
      });
    },
    [availableModels, setSelectedModel]
  );

  // Render function for LegendList
  const renderModelItem = useCallback(
    ({ item }: { item: RoutstrModel }) => {
      const isSelected = getSelectedModel() === item.id;
      return <ModelListItem model={item} isSelected={isSelected} onSelect={handleModelSelect} />;
    },
    [getSelectedModel, handleModelSelect]
  );

  const toggleAnonymousMode = () => {
    const currentMode = getAnonymousMode();
    setAnonymousMode(!currentMode);
    if (!currentMode) {
      setMessages([]);
      clearConversation();
    } else {
      if (!getCurrentSessionId()) {
        createSession();
      }
    }
  };

  const handleNewSession = () => {
    createSession();
    setMessages([]);
  };

  // ===========================
  // RENDER
  // ===========================

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
              {isRoutstrMode ? (
                <Pressable onPress={() => setIsSessionsPanelOpen(true)} className="p-2">
                  <Icon name="mdi:menu" size={24} color={getPrimaryColor('0')} />
                </Pressable>
              ) : (
                <Pressable onPress={() => router.back()} className="p-2">
                  <Icon
                    name="material-symbols:arrow-back-rounded"
                    size={24}
                    color={getPrimaryColor('0')}
                  />
                </Pressable>
              )}

              {Platform.OS === 'ios' && isRoutstrMode ? (
                <Host style={{ width: screenWidth - 100, height: 48, zIndex: 10 }}>
                  <ContextMenu>
                    <ContextMenu.Items>
                      <Button systemImage="arrow.clockwise" onPress={handleRefreshBalance}>
                        Refresh Balance
                      </Button>
                      <Button systemImage="creditcard" onPress={handleTopUp}>
                        Top Up Balance
                      </Button>
                      <Button
                        systemImage="cpu"
                        onPress={() => setIsModelSwitchBottomSheetOpen(true)}>
                        Switch Model
                      </Button>
                      <Button
                        systemImage="square.stack"
                        onPress={() => setIsSessionsPanelOpen(true)}>
                        View Sessions
                      </Button>
                      <Button systemImage="plus.square" onPress={handleNewSession}>
                        New Session
                      </Button>
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          width: '100%',
                          height: '100%',
                        }}>
                        <Avatar
                          size={40}
                          picture={userPicture}
                          seed={pubkey}
                          name={displayName}
                          loading={shouldShowAvatarLoading}
                        />
                        <View
                          style={{
                            marginLeft: 8,
                            flex: 1,
                            minWidth: 0,
                            justifyContent: 'flex-start',
                            alignItems: 'flex-start',
                          }}>
                          <Text
                            loading={shouldShowAvatarLoading}
                            size={16}
                            bold
                            style={{
                              color: getPrimaryColor('0'),
                              textAlign: 'left',
                            }}>
                            {displayName}
                          </Text>
                          {isRoutstrMode ? (
                            <HStack
                              align="center"
                              justify="flex-start"
                              spacing={4}
                              style={{ marginTop: 2 }}>
                              {getAnonymousMode() && (
                                <>
                                  <Icon
                                    name="mdi:anonymous"
                                    size={14}
                                    color={getShadeColor('400')}
                                    className="border-r-[1.5px] border-r-shade-300 pr-1"
                                  />
                                </>
                              )}
                              <Icon
                                name="material-symbols:account-balance-wallet"
                                size={14}
                                color={getShadeColor('400')}
                              />
                              <Text size={12} style={{ color: getShadeColor('400') }}>
                                {formatBalance(balance)}
                              </Text>
                              <Spacer size={4} />
                              <Icon name="mdi:robot" size={14} color={getShadeColor('400')} />
                              <Text
                                size={12}
                                style={{ color: getShadeColor('400') }}
                                numberOfLines={1}>
                                {selectedModelName || getSelectedModel()}
                              </Text>
                            </HStack>
                          ) : (
                            <Text
                              size={12}
                              style={{
                                color: getShadeColor('400'),
                                marginTop: 2,
                                textAlign: 'left',
                              }}
                              numberOfLines={1}>
                              {nip19.npubEncode(pubkey)}
                            </Text>
                          )}
                        </View>
                      </View>
                    </ContextMenu.Trigger>
                  </ContextMenu>
                </Host>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    width: '100%',
                    height: '100%',
                  }}>
                  <Avatar
                    size={40}
                    picture={userPicture}
                    seed={pubkey}
                    name={displayName}
                    loading={shouldShowAvatarLoading}
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
                    <View style={{ width: screenWidth, overflow: 'hidden' }}>
                      {/* <AnimatedText
                        loading={shouldShowAvatarLoading}
                        size={16}
                        bold
                        style={{
                          color: getPrimaryColor('0'),
                          textAlign: 'left',
                        }}
                        skeletonWidth={screenWidth - 240}
                        skeletonHeight={18}>
                        {displayName}
                      </AnimatedText> */}
                      <Text
                        loading={shouldShowAvatarLoading}
                        size={16}
                        bold
                        style={{
                          color: getPrimaryColor('0'),
                          textAlign: 'left',
                        }}>
                        {displayName}
                      </Text>
                    </View>
                    {isRoutstrMode ? (
                      <HStack align="center" justify="flex-start">
                        <Icon
                          name="material-symbols:account-balance-wallet"
                          size={14}
                          color={getShadeColor('400')}
                        />
                        <Text size={12} style={{ color: getShadeColor('400') }}>
                          {formatBalance(balance)}
                        </Text>
                        <Icon name="mdi:robot" size={14} color={getShadeColor('400')} />
                        <Text size={12} style={{ color: getShadeColor('400') }} numberOfLines={1}>
                          {selectedModelName || getSelectedModel()}
                        </Text>
                      </HStack>
                    ) : (
                      <Text
                        size={12}
                        style={{
                          color: getShadeColor('400'),
                          marginTop: 2,
                          textAlign: 'left',
                        }}
                        numberOfLines={1}>
                        {truncateMiddle(nip19.npubEncode(pubkey), 5)}
                      </Text>
                    )}
                  </VStack>
                </View>
              )}
            </HStack>

            <HStack align="center" spacing={12} style={{ flexShrink: 0 }}>
              {isRoutstrMode ? (
                <>
                  {messages.length > 0 && !getAnonymousMode() ? (
                    <Pressable onPress={handleNewSession} className="p-2">
                      <Icon name="lucide:square-pen" size={20} color={getPrimaryColor('0')} />
                    </Pressable>
                  ) : (
                    <Pressable onPress={toggleAnonymousMode} className="p-2">
                      <Icon
                        name={getAnonymousMode() ? 'mdi:anonymous' : 'mdi:anonymous-off'}
                        size={20}
                        color={getPrimaryColor('0')}
                      />
                    </Pressable>
                  )}
                </>
              ) : (
                <Pressable
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
              )}
            </HStack>
          </HStack>
        </View>

        {/* Attachments Bottom Sheet */}
        {isRoutstrMode && Platform.OS === 'ios' && (
          <Host
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: isAttachmentsBottomSheetOpen ? 100 : 1,
              pointerEvents: isAttachmentsBottomSheetOpen ? 'auto' : 'none',
            }}>
            <BottomSheet
              isOpened={isAttachmentsBottomSheetOpen}
              onIsOpenedChange={setIsAttachmentsBottomSheetOpen}>
              <VStack spacing={16} style={{ padding: 20 }}>
                <Pressable
                  onPress={() => {
                    setIsAttachmentsBottomSheetOpen(false);
                    router.push('/camera');
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 16,
                    backgroundColor: getPrimaryColor('800'),
                    borderRadius: 12,
                  }}>
                  <Icon name="proicons:photo" size={24} color={getPrimaryColor('0')} />
                  <Text size={16} style={{ color: getPrimaryColor('0'), marginLeft: 12 }} bold>
                    Camera
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIsAttachmentsBottomSheetOpen(false);
                    popup({ message: 'Photo picker coming soon', emoji: '📸', type: 'info' });
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 16,
                    backgroundColor: getPrimaryColor('800'),
                    borderRadius: 12,
                  }}>
                  <Icon name="proicons:photo" size={24} color={getPrimaryColor('0')} />
                  <Text size={16} style={{ color: getPrimaryColor('0'), marginLeft: 12 }} bold>
                    Photos
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIsAttachmentsBottomSheetOpen(false);
                    handleNewSession();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 16,
                    backgroundColor: getPrimaryColor('800'),
                    borderRadius: 12,
                  }}>
                  <Icon name="lucide:square-pen" size={24} color={getPrimaryColor('0')} />
                  <Text size={16} style={{ color: getPrimaryColor('0'), marginLeft: 12 }} bold>
                    New Session
                  </Text>
                </Pressable>
              </VStack>
            </BottomSheet>
          </Host>
        )}

        {/* OPTIMIZED: Model Switch Bottom Sheet - Using LegendList for Performance */}
        {isRoutstrMode && Platform.OS === 'ios' && (
          <Host
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: isModelSwitchBottomSheetOpen ? 100 : 1,
              pointerEvents: isModelSwitchBottomSheetOpen ? 'auto' : 'none',
            }}>
            <BottomSheet
              isOpened={isModelSwitchBottomSheetOpen}
              onIsOpenedChange={setIsModelSwitchBottomSheetOpen}
              presentationDetents={bottomSheetDetents}>
              <VStack spacing={16} style={{ paddingTop: 20, paddingBottom: 40, flex: 1 }}>
                {/* Title */}
                <Text size={20} bold style={{ color: getPrimaryColor('0'), paddingHorizontal: 16 }}>
                  Select Model
                </Text>

                {/* Provider Filter using SwiftUI */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Host matchContents fixedSize={true} style={{ width: screenWidth }}>
                    <SwiftUIHStack
                      spacing={12}
                      alignment="center"
                      modifiers={[padding({ leading: 16, trailing: 16, top: 8, bottom: 8 })]}>
                      {/* Individual Provider Buttons */}
                      {uniqueProviders.map((provider) => (
                        <Button
                          key={provider}
                          variant="plain"
                          onPress={() => setSelectedProvider(provider)}
                          modifiers={[
                            padding({ horizontal: 12, vertical: 8 }),
                            background(
                              selectedProvider === provider
                                ? getPrimaryColor('400')
                                : getPrimaryColor('500')
                            ),
                            cornerRadius(8),
                            fixedSize({ horizontal: true, vertical: false }), // This prevents horizontal shrinking
                          ]}>
                          <SwiftUIHStack spacing={6} alignment="center">
                            <SwiftUIVStack
                              alignment="leading"
                              modifiers={[frame({ width: 20, height: 20 })]}>
                              <Icon
                                name={getProviderIcon(provider)}
                                size={20}
                                color={getPrimaryColor('0')}
                              />
                            </SwiftUIVStack>
                            <SwiftUIText
                              size={16}
                              weight="semibold"
                              modifiers={[foregroundStyle(getPrimaryColor('0'))]}>
                              {provider}
                            </SwiftUIText>
                          </SwiftUIHStack>
                        </Button>
                      ))}
                    </SwiftUIHStack>
                  </Host>
                </ScrollView>

                {/* OPTIMIZED: Models List using LegendList for better performance */}
                {filteredModels.length > 0 ? (
                  <View style={{ flex: 1, height: 500 }}>
                    <LegendList
                      data={filteredModels}
                      renderItem={renderModelItem}
                      keyExtractor={(item: RoutstrModel) => item.id}
                      estimatedItemSize={72}
                      style={{ flex: 1 }}
                      contentContainerStyle={{ paddingBottom: 20 }}
                      maintainVisibleContentPosition
                      waitForInitialLayout={true}
                      recycleItems
                      getEstimatedItemSize={() => 96}
                      drawDistance={260}
                    />
                  </View>
                ) : (
                  <VStack
                    spacing={12}
                    align="center"
                    style={{ padding: 20, justifyContent: 'center', alignItems: 'center' }}>
                    <Text size={14} style={{ color: getShadeColor('400') }}>
                      {apiKey ? 'Loading models...' : 'No API key configured'}
                    </Text>
                    {apiKey && (
                      <Pressable
                        onPress={loadModels}
                        style={{
                          marginTop: 12,
                          backgroundColor: getPrimaryColor('600'),
                          borderRadius: 8,
                          paddingVertical: 8,
                          paddingHorizontal: 16,
                        }}>
                        <Text size={14} bold style={{ color: getPrimaryColor('0') }}>
                          Retry
                        </Text>
                      </Pressable>
                    )}
                  </VStack>
                )}
              </VStack>
            </BottomSheet>
          </Host>
        )}

        {/* Messages */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={scrollViewRef}
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
                  isStreaming={streamingMessageId === message.id}
                />
              ))
            )}
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* Input Area */}
        <View
          style={{
            backgroundColor: getPrimaryColor('800'),
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom,
            borderTopWidth: 1,
            borderTopColor: getPrimaryColor('700'),
          }}>
          {isRoutstrMode && (balance === null || balance < 1000) && (
            <Pressable
              onPress={handleTopUp}
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
                <Icon name="solar:wallet-bold" size={20} color={getPrimaryColor('0')} />
                <Text
                  size={16}
                  bold
                  style={{
                    color: getPrimaryColor('0'),
                  }}>
                  Top Up Balance
                </Text>
              </HStack>
            </Pressable>
          )}
          {!isRoutstrMode && lud16 && (
            <Pressable
              onPress={handleSendMoney}
              style={{
                width: '100%',
                backgroundColor: getPrimaryColor('600'),
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 16,
                marginBottom: 8,
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
            {isRoutstrMode ? (
              <Pressable
                onPress={() => setIsAttachmentsBottomSheetOpen(true)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: getPrimaryColor('700'),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon name="fluent:add-24-filled" size={24} color={getPrimaryColor('0')} />
              </Pressable>
            ) : (
              <Avatar size={40} seed={nostrKeys?.pubkey} loading={false} />
            )}

            <TextInput
              value={messageText}
              onChangeText={setMessageText}
              placeholder="Type a message..."
              style={{
                flex: 1,
                backgroundColor: getPrimaryColor('700'),
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderWidth: 0,
                margin: 0,
                shadowOpacity: 0,
              }}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSendMessage}
            />

            <Pressable onPress={handleSendMessage} disabled={!messageText.trim() || isSending}>
              <Icon
                name="iconamoon:send-fill"
                size={24}
                color={
                  messageText.trim() && !isSending ? getPrimaryColor('0') : getShadeColor('500')
                }
              />
            </Pressable>
          </HStack>
        </View>
      </View>

      {/* Sessions Panel */}
      {isRoutstrMode && (
        <SessionsPanel
          isOpen={isSessionsPanelOpen}
          onClose={() => setIsSessionsPanelOpen(false)}
          onSessionSelect={() => {}}
          onNewSession={handleNewSession}
        />
      )}
    </KeyboardAvoidingView>
  );
}

export default withSheetProvider(ModalScreen);
