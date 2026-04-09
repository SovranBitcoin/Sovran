/**
 * @fileoverview Shared User Messages screen component
 *
 * This module provides the core UI and logic for the direct messages interface.
 * It is used by both standalone and flow-based route wrappers.
 */

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
  InteractionManager,
  TextInput as RNTextInput,
  Animated as RNAnimated,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  buttonHandlerPopup,
  invalidTokenPopup,
  balanceRefreshedPopup,
  balanceRefreshFailedPopup,
  noWalletAvailablePopup,
  noApiKeyPopup,
  sendMessageFailedPopup,
  modelSwitchedPopup,
  photoPickerComingSoonPopup,
} from '@/shared/lib/popup';
import { nip19 } from 'nostr-tools';
import {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKUser,
  useNDK,
  useSubscribe,
} from '@nostr-dev-kit/ndk-mobile';
import { Metadata, EncryptedDirectMessage } from 'nostr-tools/kinds';
import { buildGiftWrappedDMPair, unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
import { LegendList } from '@legendapp/list';

// Custom hooks and providers
import { Message } from '@/redux/nostr/reducer.deprecated';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

// Components
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import TextInput from '@/shared/ui/primitives/TextInput';
import Icon from 'assets/icons';
import { SessionsPanel } from '@/features/user/components/routstr/SessionsPanel';
import {
  ContextMenu,
  Host,
  Button as SwiftUIButton,
  BottomSheet,
  Text as SwiftUIText,
  TextField,
  VStack as SwiftUIVStack,
  HStack as SwiftUIHStack,
} from '@expo/ui/swift-ui';
import { Button } from '@/shared/ui/primitives/Button';

// Utilities
import { isValidEcashToken } from '@/shared/lib/cashu/utils';
import { ROUTSTR_PUBKEY } from '@/shared/lib/constants';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { checkBalance, sendMessage, getModels, RoutstrModel } from '@/shared/lib/routstr/api';
import { getDecodedToken, ReceiveHistoryEntry } from '@cashu/coco-core';
import { Proof } from '@cashu/cashu-ts';
import { formatAmount } from '@/shared/lib/currency';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { LinearGradient } from 'expo-linear-gradient';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  padding,
  background,
  cornerRadius,
  fixedSize,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { truncateMiddle } from '@/shared/lib/strings';
import { getUsername } from '@/shared/lib/username';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen, log, useLifecycleLogger } from '@/shared/lib/logger';

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

function extractProviderFromSlug(canonicalSlug: string | null | undefined): string {
  if (!canonicalSlug) return 'Unknown';
  const parts = canonicalSlug.split('/');
  const provider = parts[0] || 'Unknown';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function extractModelName(model: RoutstrModel): { provider: string; modelName: string } {
  const provider = extractProviderFromSlug(model.canonical_slug);
  const slugParts = (model.canonical_slug ?? '').split('/');
  let modelName = slugParts[1] || model.name;
  modelName = modelName.replace(/-\d{8}$/, '');

  if (model.name.includes(':')) {
    const nameParts = model.name.split(':');
    if (nameParts.length > 1) {
      modelName = nameParts[1].trim();
    }
  } else {
    modelName = model.name;
  }

  return { provider, modelName };
}

function getProviderIcon(provider: string): string {
  const providerLower = provider.toLowerCase();
  const iconMap: Record<string, string> = {
    openai: 'ri:openai-fill',
    anthropic: 'ri:anthropic-fill',
    'anthracite-org': 'ri:robot-fill',
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
    microsoft: 'simple-icons:microsoft',
    baidu: 'simple-icons:baidu',
    tencent: 'simple-icons:tencentqq',
    bytedance: 'simple-icons:tiktok',
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

// ===========================
// COMPONENTS
// ===========================

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
      id: `receive-${Date.now()}`,
      type: 'receive',
      amount,
      unit,
      mintUrl,
      createdAt: Date.now(),
      metadata: {},
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

// ===========================
// STREAMING VISUAL COMPONENTS
// ===========================

const SPINNER_VERBS = [
  'Thinking',
  'Pondering',
  'Considering',
  'Reasoning',
  'Composing',
  'Formulating',
  'Reflecting',
  'Analyzing',
  'Synthesizing',
  'Drafting',
  'Contemplating',
  'Processing',
  'Deliberating',
  'Weighing',
  'Crafting',
  'Generating',
  'Assembling',
  'Piecing together',
  'Working through',
  'Mulling over',
];

/** Animated typing indicator with cycling verb. */
function TypingIndicator({ color }: { color: string }) {
  const [verbIndex, setVerbIndex] = useState(() =>
    Math.floor(Math.random() * SPINNER_VERBS.length)
  );
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      RNAnimated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        () => {
          setVerbIndex((i) => (i + 1) % SPINNER_VERBS.length);
          RNAnimated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
      );
    }, 2000);
    return () => clearInterval(interval);
  }, [fadeAnim]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}>
      <Icon
        name="ant-design:loading-outlined"
        size={14}
        color={color}
        spin={{ duration: 1000, outputRange: ['0deg', '360deg'], delay: 0, easing: 'linear' }}
      />
      <RNAnimated.View style={{ opacity: fadeAnim, marginLeft: 8 }}>
        <Text size={14} style={{ color, fontStyle: 'italic' }}>
          {SPINNER_VERBS[verbIndex]}...
        </Text>
      </RNAnimated.View>
    </View>
  );
}

/** Blinking cursor appended to streaming text. */
function StreamingCursor({ color }: { color: string }) {
  const opacity = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        RNAnimated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <RNAnimated.View
      style={{
        width: 2,
        height: 16,
        backgroundColor: color,
        opacity,
        marginLeft: 1,
        borderRadius: 1,
      }}
    />
  );
}

interface MessageBubbleProps {
  message: any;
  isMe: boolean;
  userPicture?: string;
  userName: string;
  myName: string;
  isLoadingMetadata?: boolean;
  isStreaming?: boolean;
}

function isPlaceholderText(content: string): boolean {
  if (!content || content.length === 0) return true;

  if (content.length < 10) {
    const trimmed = content.trim().toLowerCase();
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
  userName,
  myName,
  isLoadingMetadata,
  isStreaming,
}: MessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400, shade500] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
    'shade-500',
  ] as const);

  const content = Array.isArray(message.content)
    ? message.content.join('')
    : typeof message.content === 'string'
      ? message.content
      : String(message.content || '');

  const reasoningContent = message.reasoningContent || '';
  const isStreamComplete = message.isStreamComplete !== undefined ? message.isStreamComplete : true;
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  const isThinking =
    isStreaming && !isStreamComplete && reasoningContent.length > 0 && content.length === 0;
  const shouldShowSkeleton =
    isStreaming &&
    !isStreamComplete &&
    !isThinking &&
    (content.length === 0 || isPlaceholderText(content));

  const cashuToken = extractCashuToken(content);

  let displayContent = content;
  if (cashuToken && !shouldShowSkeleton) {
    displayContent = content.replace(cashuToken, '').trim();
    if (!displayContent) {
      displayContent = '';
    }
  }

  if (!shouldShowSkeleton && displayContent === '' && cashuToken) {
    displayContent = '';
  } else {
    displayContent = shouldShowSkeleton ? '' : displayContent;
  }

  const thinkingDuration = message.reasoningDurationSec;
  const thinkingLabel =
    thinkingDuration != null && thinkingDuration >= 1
      ? `Thought for ${thinkingDuration} second${thinkingDuration !== 1 ? 's' : ''}`
      : 'Thought briefly';
  const showThinkingHeader =
    !isMe && ((thinkingDuration != null && thinkingDuration >= 1) || reasoningContent.length > 0);

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
            name={isMe ? myName : userName}
            loading={isLoadingMetadata}
          />
        )}

        <VStack
          align={isMe ? 'flex-end' : 'flex-start'}
          spacing={4}
          style={{ flex: 1, maxWidth: '85%' }}>
          {(displayContent || shouldShowSkeleton || isThinking) && (
            <View
              style={{
                backgroundColor: isMe ? defaultColor : surfaceTertiary,
                borderRadius: 18,
                borderTopLeftRadius: isMe ? 18 : 4,
                borderTopRightRadius: isMe ? 4 : 18,
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                minHeight: shouldShowSkeleton ? 44 : undefined,
                minWidth: shouldShowSkeleton ? 60 : undefined,
              }}>
              {shouldShowSkeleton ? (
                <TypingIndicator color={shade400} />
              ) : isThinking ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <HStack align="center" spacing={6}>
                    <Icon
                      name="ant-design:loading-outlined"
                      size={14}
                      color={shade400}
                      spin={{
                        duration: 1000,
                        outputRange: ['0deg', '360deg'],
                        delay: 0,
                        easing: 'linear',
                      }}
                    />
                    <Text size={14} style={{ color: shade400, fontStyle: 'italic' }}>
                      Thinking...
                    </Text>
                  </HStack>
                  <Text
                    size={13}
                    style={{ color: shade400, lineHeight: 18, marginTop: 6 }}
                    numberOfLines={4}>
                    {reasoningContent}
                  </Text>
                </View>
              ) : (
                <View>
                  {showThinkingHeader &&
                    (reasoningContent.length > 0 ? (
                      <Pressable
                        onPress={() => setReasoningExpanded((v) => !v)}
                        style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
                        <HStack align="center" spacing={4}>
                          <Icon name="mdi:brain" size={14} color={shade400} />
                          <Text size={13} style={{ color: shade400, fontStyle: 'italic' }}>
                            {thinkingLabel}
                          </Text>
                          <Icon
                            name={reasoningExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                            size={14}
                            color={shade400}
                          />
                        </HStack>
                        {reasoningExpanded && (
                          <Text size={13} style={{ color: shade400, lineHeight: 18, marginTop: 4 }}>
                            {reasoningContent}
                          </Text>
                        )}
                      </Pressable>
                    ) : (
                      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
                        <HStack align="center" spacing={4}>
                          <Icon name="mdi:brain" size={14} color={shade400} />
                          <Text size={13} style={{ color: shade400, fontStyle: 'italic' }}>
                            {thinkingLabel}
                          </Text>
                        </HStack>
                      </View>
                    ))}
                  {isStreaming && !isStreamComplete ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'flex-end',
                        paddingHorizontal: 16,
                        paddingVertical: showThinkingHeader ? 8 : 12,
                      }}>
                      <Text
                        size={16}
                        style={{
                          color: foreground,
                          lineHeight: 20,
                        }}>
                        {displayContent}
                      </Text>
                      <StreamingCursor color={foreground} />
                    </View>
                  ) : (
                    <Text
                      size={16}
                      style={{
                        color: foreground,
                        lineHeight: 20,
                        paddingHorizontal: 16,
                        paddingVertical: showThinkingHeader ? 8 : 12,
                      }}>
                      {displayContent}
                    </Text>
                  )}
                </View>
              )}
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
                <Icon name="svg-spinners:90-ring-with-bg" size={14} color={shade500} />
              ) : (
                <Icon
                  name={message.isRead ? 'ion:checkmark-done' : 'simple-line-icons:check'}
                  size={14}
                  color={message.isRead ? opacity(foreground, 0.4) : shade500}
                />
              ))}
          </HStack>
        </VStack>

        {isMe && <Avatar size={32} seed={message.pubkey} name={myName} />}
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
  canAfford?: boolean;
}

const ModelListItem = React.memo(({ model, onSelect, canAfford = true }: ModelListItemProps) => {
  const [foreground, shade400] = useThemeColor(['foreground', 'shade-400'] as const);
  const { provider, modelName } = extractModelName(model);

  const pricePerToken = model.sats_pricing?.completion || 0;
  const minAmount = Math.ceil(model.sats_pricing?.max_cost || 0);
  const tokensPerSat = pricePerToken > 0 ? Math.round(1 / pricePerToken) : 0;

  return (
    <Host matchContents={false} style={{ height: 96, opacity: canAfford ? 1 : 0.4 }}>
      <SwiftUIButton
        modifiers={[
          buttonStyle('plain'),
          frame({
            height: 96,
            width: Dimensions.get('window').width - 32,
            alignment: 'leading',
          }),
          padding({ all: 0 }),
        ]}
        onPress={() => {
          log.debug('user.messages.model_selected', { modelId: model.id });
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
          ]}>
          <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 24, height: 24 })]}>
            <Icon name={getProviderIcon(provider)} size={24} color={foreground} />
          </SwiftUIVStack>

          <SwiftUIVStack
            spacing={4}
            alignment="leading"
            modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SwiftUIText
              modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(foreground)]}>
              {modelName}
            </SwiftUIText>
            <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle(shade400)]}>
              {provider}
            </SwiftUIText>
            <SwiftUIHStack alignment="center" spacing={8}>
              <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 16, height: 16 })]}>
                <Icon
                  name={'material-symbols:account-balance-wallet'}
                  size={16}
                  color={foreground}
                />
              </SwiftUIVStack>
              <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle(shade400)]}>
                {`${minAmount} sats`}
              </SwiftUIText>
              <SwiftUIVStack alignment="leading" modifiers={[frame({ width: 16, height: 16 })]}>
                <Icon name={'solar:tag-price-bold'} size={16} color={foreground} />
              </SwiftUIVStack>
              <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle(shade400)]}>
                {tokensPerSat > 0 ? `${tokensPerSat.toLocaleString()} tok/sat` : 'Free'}
              </SwiftUIText>
            </SwiftUIHStack>
          </SwiftUIVStack>
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  );
});

ModelListItem.displayName = 'ModelListItem';

// ===========================
// PROPS INTERFACE
// ===========================
interface UserMessagesScreenProps {
  pubkey: string;
  /** Optional callback for back navigation - if not provided, uses router.back() */
  onBack?: () => void;
  /** Whether this is rendered in a flow context (affects header styling) */
  isFlowContext?: boolean;
}

// ===========================
// MAIN COMPONENT
// ===========================
export function UserMessagesScreen({
  pubkey,
  onBack,
  isFlowContext: _isFlowContext = false,
}: UserMessagesScreenProps) {
  useLifecycleLogger('UserMessagesScreen');
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const screenWidth = Dimensions.get('window').width;
  const listRef = useRef<any>(null);

  const [
    foreground,
    muted,
    accent,
    defaultColor,
    surfaceTertiary,
    surfaceSecondary,
    surface,
    shade400,
    shade500,
  ] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'default',
    'surface-tertiary',
    'surface-secondary',
    'surface',
    'shade-400',
    'shade-500',
  ] as const);
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
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionClearKey, setSessionClearKey] = useState(0);
  const [isSessionSearchFocused, setIsSessionSearchFocused] = useState(false);
  const [availableModels, setAvailableModels] = useState<RoutstrModel[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  // Routstr mode detection
  const isRoutstrMode = pubkey === ROUTSTR_PUBKEY;

  // Calculate minimum bottom sheet detent (kept for potential future use)
  const _bottomSheetDetents = useMemo((): ('medium' | 'large' | number)[] => {
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
    removeMessages,
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
    apiKey,
    selectedModel, // Subscribe directly to selectedModel for reactivity
  } = useRoutstrStore();

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

  // NIP-17: Subscribe to gift-wrapped events (kind 1059) addressed to us
  const giftWrapFilters = useMemo(() => {
    if (isRoutstrMode || !nostrKeys?.pubkey) return null;

    return [
      {
        kinds: [1059 as number],
        '#p': [nostrKeys.pubkey],
      },
    ];
  }, [nostrKeys?.pubkey, isRoutstrMode]);

  const { events: giftWrapEvents } = useSubscribe({ filters: giftWrapFilters });

  // NIP-17: Unwrap gift-wrapped events and filter for this conversation
  const unwrappedGiftWrapMessages = useMemo(() => {
    if (!giftWrapEvents?.length || !nostrKeys?.privateKey || !nostrKeys?.pubkey) return [];

    return giftWrapEvents
      .map((event) => {
        const unwrapped = unwrapGiftWrap(
          { content: event.content, pubkey: event.pubkey },
          nostrKeys.privateKey
        );
        if (!unwrapped) return null;

        // Filter: only messages in this conversation (between us and pubkey)
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

  // ===========================
  // DERIVED STATE
  // ===========================
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = isRoutstrMode
    ? userInfo?.display_name || userInfo?.name || 'routstr'
    : userInfo?.display_name || userInfo?.name || getUsername(pubkey);
  const userPicture = userInfo?.picture;
  const lud16 = userInfo?.lud16;
  const myProfile = useProfileDisplay(nostrKeys?.pubkey || '');
  const myName = myProfile.displayName;
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
  const balanceMsats = balance ?? 0;

  const filteredModels = useMemo(() => {
    const base = selectedProvider
      ? availableModels.filter((model) => extractModelName(model).provider === selectedProvider)
      : availableModels;
    // Sort: affordable first (ascending cost), then unaffordable (ascending cost)
    return [...base].sort((a, b) => {
      const aCost = (a.sats_pricing?.max_cost || 0) * 1000;
      const bCost = (b.sats_pricing?.max_cost || 0) * 1000;
      const aAfford = aCost <= balanceMsats;
      const bAfford = bCost <= balanceMsats;
      if (aAfford !== bAfford) return aAfford ? -1 : 1;
      return aCost - bCost;
    });
  }, [availableModels, selectedProvider, balanceMsats]);

  // Get selected model name - uses selectedModel directly for reactivity when model changes externally
  const selectedModelName = useMemo(() => {
    if (!isRoutstrMode) return null;
    const selectedModelId = selectedModel || 'gpt-3.5-turbo';
    const model = availableModels.find((m) => m.id === selectedModelId);
    if (!model) return selectedModelId;
    const { modelName } = extractModelName(model);
    return modelName;
  }, [isRoutstrMode, availableModels, selectedModel]);

  // ===========================
  // HANDLERS
  // ===========================

  const loadModels = useCallback(async () => {
    const t0 = performance.now();
    try {
      const cached = getCachedModels();
      if (cached && cached.length > 0) {
        log.debug('routstr.models.from_cache', { count: cached.length });
        setAvailableModels(cached);
      } else {
        log.info('routstr.models.fetching');
        const models = await getModels();
        log.info('routstr.models.loaded', {
          count: models.length,
          duration_ms: Math.round(performance.now() - t0),
        });
        if (models && models.length > 0) {
          setCachedModels(models);
          setAvailableModels(models);
        }
      }
    } catch (error) {
      log.error('routstr.models.load_failed', {
        error,
        duration_ms: Math.round(performance.now() - t0),
      });
    }
  }, [getCachedModels, setCachedModels]);

  // ===========================
  // EFFECTS
  // ===========================

  // Initialize Routstr - deferred to allow smooth navigation
  useEffect(() => {
    if (!isRoutstrMode) return;

    // Immediately set up session and messages (sync operations)
    const initStart = performance.now();
    if (!getCurrentSessionId()) {
      const sessions = getAllSessions();
      if (sessions.length > 0) {
        log.debug('routstr.init.restore_session', {
          sessionId: sessions[0].id,
          sessionCount: sessions.length,
        });
        switchSession(sessions[0].id);
      } else {
        log.debug('routstr.init.create_first_session');
        createSession();
      }
    }

    const history = getConversationHistory();
    const formattedMessages = history.map((msg) => ({
      id: msg.id,
      content: msg.content,
      sender: msg.role === 'user' ? 'me' : 'other',
      timestamp: formatTimestamp(msg.timestamp),
      isRead: true,
      created_at: msg.timestamp,
      pubkey: msg.role === 'user' ? nostrKeys?.pubkey || 'me' : ROUTSTR_PUBKEY,
      ...(msg.thinkingDurationSec != null && { reasoningDurationSec: msg.thinkingDurationSec }),
      ...(msg.reasoningContent && { reasoningContent: msg.reasoningContent }),
    }));
    setMessages(formattedMessages);
    setIsLoading(false);
    log.info('routstr.init.sync_done', {
      messageCount: formattedMessages.length,
      duration_ms: Math.round(performance.now() - initStart),
    });

    // Defer expensive API calls until after navigation animation completes
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      log.debug('routstr.init.deferred_start');
      loadModels();

      if (apiKey) {
        log.debug('routstr.init.balance_check');
        checkBalance(apiKey)
          .then((balanceData) => {
            if (balanceData.api_key && balanceData.api_key !== apiKey) {
              log.info('routstr.init.api_key_updated');
              setApiKey(balanceData.api_key);
            }
            setBalance(balanceData.balance);
            log.info('routstr.init.balance_loaded', { balance: balanceData.balance });
          })
          .catch((error) => {
            log.error('routstr.init.balance_check_failed', { error });
          });
      } else {
        log.debug('routstr.init.no_api_key');
      }
    });

    return () => {
      interactionHandle.cancel();
    };
  }, [
    isRoutstrMode,
    apiKey,
    nostrKeys?.pubkey,
    createSession,
    getAllSessions,
    getConversationHistory,
    getCurrentSessionId,
    loadModels,
    setApiKey,
    setBalance,
    switchSession,
  ]);

  // Load models - doesn't require API key (public endpoint)
  useEffect(() => {
    if (!isRoutstrMode || availableModels.length > 0) return;

    // Use cached models immediately if available
    const cached = getCachedModels();
    if (cached && cached.length > 0) {
      setAvailableModels(cached);
      return;
    }

    // Defer network request until after interactions
    const handle = InteractionManager.runAfterInteractions(() => {
      loadModels();
    });

    return () => handle.cancel();
  }, [isRoutstrMode, availableModels.length, getCachedModels, loadModels]);

  // Listen for session changes
  const currentSessionId = getCurrentSessionId();
  const nostrPubkey = nostrKeys?.pubkey;
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
      pubkey: msg.role === 'user' ? nostrPubkey || 'me' : ROUTSTR_PUBKEY,
      ...(msg.thinkingDurationSec != null && { reasoningDurationSec: msg.thinkingDurationSec }),
      ...(msg.reasoningContent && { reasoningContent: msg.reasoningContent }),
    }));
    setMessages(formattedMessages);
  }, [isRoutstrMode, currentSessionId, nostrPubkey, getConversationHistory]);

  // Track processed event IDs
  const processedEventIds = useRef<Set<string>>(new Set());

  // Reset processed events when conversation changes (only for Nostr DM mode)
  useEffect(() => {
    // Skip reset for routstr mode - it manages its own state
    if (isRoutstrMode) return;

    processedEventIds.current.clear();
    setMessages([]);
    setIsLoading(true);
  }, [pubkey, isRoutstrMode]);

  // Process NIP-04 DM events - deferred to avoid blocking navigation
  useEffect(() => {
    if (isRoutstrMode) return;

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

    // Defer expensive decryption until after navigation completes
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const processedMessages = await Promise.all(
          newEvents.map(async (event) => {
            try {
              const counterparty = new NDKUser({ pubkey: pubkey });
              const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);
              await event.decrypt(counterparty, signer);
              const isMe = event.pubkey === nostrKeys.pubkey;
              const senderPubkey = isMe ? nostrKeys.pubkey : event.pubkey;

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
              log.error('user.messages.nip04_decrypt_failed', { error });
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
  }, [dmEvents, nostrKeys?.pubkey, nostrKeys?.privateKey, pubkey, isRoutstrMode]);

  // Process NIP-17 gift-wrapped DM events (already decrypted by unwrapGiftWrap)
  useEffect(() => {
    if (isRoutstrMode || !nostrKeys?.pubkey) return;

    if (unwrappedGiftWrapMessages.length === 0) return;

    const newMessages = unwrappedGiftWrapMessages.filter(
      (dm) => !processedEventIds.current.has(dm.wrapId)
    );

    if (newMessages.length === 0) return;

    const formatted = newMessages.map((dm) => {
      processedEventIds.current.add(dm.wrapId);
      const isMe = dm.senderPubkey === nostrKeys.pubkey;

      return {
        id: dm.wrapId,
        content: dm.content,
        sender: isMe ? ('me' as const) : ('other' as const),
        timestamp: formatTimestamp(dm.created_at),
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
  }, [unwrappedGiftWrapMessages, nostrKeys?.pubkey, isRoutstrMode]);

  const handleRefreshBalance = async () => {
    if (!apiKey || isRefreshingBalance) return;

    setIsRefreshingBalance(true);
    try {
      const balanceData = await checkBalance(apiKey);
      if (balanceData.api_key && balanceData.api_key !== apiKey) {
        setApiKey(balanceData.api_key);
      }
      setBalance(balanceData.balance);
      balanceRefreshedPopup({ balance: formatBalance(balanceData.balance) });
    } catch (error: any) {
      log.error('user.messages.balance_refresh_failed', { error });
      balanceRefreshFailedPopup({ text: error.error?.message });
    } finally {
      setIsRefreshingBalance(false);
    }
  };

  const handleTopUp = async (pendingMessage?: string) => {
    if (!nostrKeys?.pubkey) {
      noWalletAvailablePopup();
      return;
    }

    useRoutstrTopUpStore.getState().start(pendingMessage ?? null);
    const preferredMint = useMintStore.getState().getSelectedMint(nostrKeys.pubkey) ?? '';
    log.info('routstr.topup.navigate', { hasPendingMessage: !!pendingMessage, preferredMint });
    router.navigate({
      pathname: '/(send-flow)/amount',
      params: {
        amountEntry: JSON.stringify({
          destination: 'sendEcash',
          unit: 'sat',
          selectedMintUrl: preferredMint,
        }),
      },
    });
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const handleRoutstrSend = async (userMessage: string) => {
    const sendStart = performance.now();

    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      log.warn('routstr.send.invalid_message', {
        type: typeof userMessage,
        length: (userMessage as any)?.length,
      });
      return;
    }

    log.info('routstr.send.start', {
      messageLength: userMessage.length,
      hasApiKey: !!apiKey,
      balance,
    });

    if (!apiKey) {
      log.warn('routstr.send.no_api_key');
      noApiKeyPopup();
      return;
    }

    const isAnonymous = getAnonymousMode();
    log.debug('routstr.send.mode', { isAnonymous });

    if (!isAnonymous) {
      let currentSessionId = getCurrentSessionId();
      if (!currentSessionId) {
        currentSessionId = createSession();
        log.info('routstr.send.session_created', { sessionId: currentSessionId });
      }
    }

    setIsSending(true);
    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);

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

    // Only add the assistant placeholder to the UI, NOT the persistent store.
    // The store gets the assistant message once we have real content,
    // preventing empty assistant messages from corrupting conversation history.
    const assistantMessageDisplay = {
      id: assistantMessageId,
      content: '',
      sender: 'other' as const,
      timestamp: formatTimestamp(timestamp + 1),
      isRead: true,
      created_at: timestamp + 1,
      pubkey: ROUTSTR_PUBKEY,
      isStreamComplete: false,
    };
    setMessages((prev) => [...prev, assistantMessageDisplay]);

    setStreamingMessageId(assistantMessageId);

    // LegendList maintainScrollAtEnd handles this automatically
    let assistantAddedToStore = false;

    try {
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
          .filter((msg) => msg.content)
          .map((msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          }));
      }

      const selectedModel = getSelectedModel();
      log.debug('routstr.send.api_call', {
        model: selectedModel,
        historyCount: apiMessages.length,
      });
      const { stream } = await sendMessage(apiKey, apiMessages, {
        model: selectedModel,
        temperature: 0.7,
        stream: true,
      });

      if (!stream) {
        log.error('routstr.send.no_stream');
        throw new Error('Stream not available');
      }
      log.debug('routstr.send.stream_opened', {
        elapsed_ms: Math.round(performance.now() - sendStart),
      });

      let fullContent = '';
      let fullReasoning = '';
      let chunkCount = 0;
      let hasReceivedAnyContent = false;
      let isStreamComplete = false;
      let thinkingSec = 0;

      for await (const chunk of stream) {
        chunkCount++;

        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason !== null && finishReason !== undefined) {
          isStreamComplete = true;
        }

        const delta = chunk.choices?.[0]?.delta;
        const content =
          delta?.content || (delta as any)?.message?.content || (delta as any)?.text || null;
        const reasoningContent =
          (delta as any)?.reasoning_content || (delta as any)?.reasoning || null;

        if (chunkCount <= 5) {
          log.debug('user.messages.stream_chunk', {
            chunkCount,
            hasContent: !!content,
            hasReasoning: !!reasoningContent,
          });
        }

        if (reasoningContent) {
          hasReceivedAnyContent = true;
          fullReasoning += reasoningContent;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, reasoningContent: fullReasoning, isStreamComplete }
                : msg
            )
          );
        }

        if (content) {
          // Finalize thinking duration when first content token arrives
          if (!fullContent) {
            thinkingSec = Math.round((performance.now() - sendStart) / 1000);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId ? { ...msg, reasoningDurationSec: thinkingSec } : msg
              )
            );
          }
          hasReceivedAnyContent = true;
          fullContent += content;

          if (!isAnonymous) {
            if (!assistantAddedToStore) {
              addMessage({
                id: assistantMessageId,
                role: 'assistant',
                content: fullContent,
                timestamp: timestamp + 1,
                thinkingDurationSec: thinkingSec,
                reasoningContent: fullReasoning || undefined,
              });
              assistantAddedToStore = true;
            } else {
              updateMessage(assistantMessageId, fullContent);
            }
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: fullContent,
                    reasoningContent: fullReasoning || undefined,
                    isStreamComplete,
                  }
                : msg
            )
          );

          if (fullContent.length < 100 || fullContent.length % 100 === 0) {
            // LegendList maintainScrollAtEnd handles this automatically
          }
        } else if (isStreamComplete) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, isStreamComplete } : msg))
          );
        }
      }

      isStreamComplete = true;

      log.info('routstr.send.stream_complete', {
        totalChunks: chunkCount,
        contentLength: fullContent.length,
        reasoningLength: fullReasoning.length,
        total_ms: Math.round(performance.now() - sendStart),
      });

      if (!isAnonymous && fullContent) {
        if (!assistantAddedToStore) {
          addMessage({
            id: assistantMessageId,
            role: 'assistant',
            content: fullContent,
            timestamp: timestamp + 1,
            thinkingDurationSec: thinkingSec,
            reasoningContent: fullReasoning || undefined,
          });
        } else {
          updateMessage(assistantMessageId, fullContent);
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: fullContent, isStreamComplete: true }
            : msg
        )
      );

      setStreamingMessageId(null);

      if (!hasReceivedAnyContent && chunkCount > 0) {
        log.warn('routstr.send.stream_empty', {
          chunkCount,
          total_ms: Math.round(performance.now() - sendStart),
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: fullContent || '(No response received)' }
              : msg
          )
        );
      }

      // LegendList maintainScrollAtEnd handles this automatically

      log.debug('routstr.send.balance_refresh_start');
      try {
        const balanceData = await checkBalance(apiKey);
        const prevBalance = balance;
        setBalance(balanceData.balance);
        log.info('routstr.send.balance_refreshed', {
          prevBalance,
          newBalance: balanceData.balance,
          spent: prevBalance != null ? prevBalance - balanceData.balance : null,
        });
      } catch (error) {
        log.error('routstr.send.balance_refresh_failed', { error });
      }
    } catch (error: any) {
      if (error.status === 402) {
        const requiredMsats = error.error?.details?.required || 0;
        const availableMsats = error.error?.details?.available || 0;
        const requiredSats = Math.ceil(requiredMsats / 1000);
        const availableSats = Math.floor(availableMsats / 1000);
        const neededSats = Math.max(requiredSats - availableSats, 1);
        const modelName = getSelectedModel();
        log.warn('routstr.send.insufficient_balance', {
          requiredMsats,
          availableMsats,
          neededSats,
          model: modelName,
          total_ms: Math.round(performance.now() - sendStart),
        });

        setMessages((prev) =>
          prev.filter((msg) => msg.id !== userMessageId && msg.id !== assistantMessageId)
        );

        if (!isAnonymous) {
          removeMessages(
            new Set([userMessageId, ...(assistantAddedToStore ? [assistantMessageId] : [])])
          );
        }

        buttonHandlerPopup({
          title: 'Insufficient balance',
          description:
            requiredSats > 0
              ? `${modelName} requires ~${requiredSats} sats per message. You have ${availableSats} sats.`
              : 'Your Routstr balance is too low for this model.',
          buttons: [
            {
              text: `Top Up (~${neededSats} sats)`,
              icon: 'solar:wallet-bold',
              variant: 'primary',
              onPress: async (close: any) => {
                close({} as any);
                await handleTopUp(userMessage);
              },
            },
            {
              text: 'Change Model',
              icon: 'mdi:swap-horizontal',
              variant: 'secondary',
              onPress: async (close: any) => {
                close({} as any);
                setIsModelSwitchBottomSheetOpen(true);
              },
            },
            {
              text: 'Cancel',
              icon: 'mdi:close-circle',
              variant: 'secondary',
              onPress: async (close: any) => close({} as any),
            },
          ],
        });
        return;
      }

      log.error('routstr.send.failed', {
        status: error.status,
        message: error.error?.message,
        type: error.error?.type,
        total_ms: Math.round(performance.now() - sendStart),
      });
      sendMessageFailedPopup({ text: error.error?.message });

      setStreamingMessageId(null);

      setMessages((prev) =>
        prev.filter((msg) => msg.id !== userMessageId && msg.id !== assistantMessageId)
      );

      if (!isAnonymous) {
        removeMessages(
          new Set([userMessageId, ...(assistantAddedToStore ? [assistantMessageId] : [])])
        );
      }
    } finally {
      setIsSending(false);
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
      await handleNostrDMSend(text);
    }
  };

  // Handle Routstr top-up completion: cleanup on cancel, auto-retry pending message on success
  useFocusEffect(
    useCallback(() => {
      if (!isRoutstrMode) return;
      const state = useRoutstrTopUpStore.getState();
      if (state.active) {
        log.info('routstr.topup_focus.dismissed', { hasPendingMessage: !!state.pendingMessage });
        state.reset();
      } else if (state.lastResult === 'success' && state.pendingMessage) {
        const msg = state.pendingMessage;
        log.info('routstr.topup_focus.retry_pending', { messageLength: msg.length });
        state.reset();
        setTimeout(() => handleRoutstrSend(msg), 300);
      } else if (state.lastResult !== null) {
        log.debug('routstr.topup_focus.reset', { lastResult: state.lastResult });
        state.reset();
      }
    }, [isRoutstrMode])
  );

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

    const optimisticMessage = {
      id: tempMessageId,
      content: text,
      sender: 'me' as const,
      timestamp: formatTimestamp(timestamp),
      isRead: false,
      isSending: true,
      created_at: timestamp,
      pubkey: nostrKeys.pubkey,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // LegendList maintainScrollAtEnd handles this automatically

    try {
      // Build NIP-17 gift-wrapped DM pair: one for the recipient, one self-copy.
      // Both share the same rumor (with the counterparty in the `p` tag) per NIP-17.
      const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
        content: text,
        senderPrivateKey: nostrKeys.privateKey,
        recipientPublicKey: pubkey,
      });

      // Convert recipient wrap to NDKEvent for publishing
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

      // Publish the self-copy so we can retrieve our own sent messages later
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
    log.debug('user.messages.send_money', { lud16, userName: userInfo?.name });
    if (!lud16 || !userInfo) return;

    buttonHandlerPopup({
      buttons: [
        {
          text: 'Send Ecash',
          icon: 'ph:coins',
          variant: 'primary' as const,
          onPress: async (close: any) => {
            const mint = nostrKeys?.pubkey
              ? (useMintStore.getState().getSelectedMint(nostrKeys.pubkey) ?? '')
              : '';
            router.navigate({
              pathname: '/(send-flow)/amount',
              params: {
                amountEntry: JSON.stringify({
                  destination: 'sendEcash',
                  unit: 'sat',
                  selectedMintUrl: mint,
                }),
              },
            });
            close({} as any);
          },
        },
        {
          text: 'Send Lightning',
          icon: 'mingcute:lightning-fill',
          variant: 'primary' as const,
          onPress: async (close: any) => {
            router.navigate({
              pathname: '/(send-flow)/amount',
              params: {
                destination: 'meltQuote',
                meltTarget: lud16,
              },
            });
            close({} as any);
          },
        },
      ],
    });
  };

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      setIsModelSwitchBottomSheetOpen(false);
      const selectedModelName = availableModels.find((m) => m.id === modelId)?.name || modelId;
      modelSwitchedPopup({ modelName: selectedModelName });
    },
    [availableModels, setSelectedModel]
  );

  const renderModelItem = useCallback(
    ({ item }: { item: RoutstrModel }) => {
      const currentSelectedModel = selectedModel || 'gpt-3.5-turbo';
      const isSelected = currentSelectedModel === item.id;
      const canAfford = (item.sats_pricing?.max_cost || 0) * 1000 <= balanceMsats;
      return (
        <ModelListItem
          model={item}
          isSelected={isSelected}
          onSelect={handleModelSelect}
          canAfford={canAfford}
        />
      );
    },
    [selectedModel, handleModelSelect, balanceMsats]
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

  const handleCloseSessionsPanel = useCallback(() => {
    setIsSessionsPanelOpen(false);
    setSessionSearchQuery('');
    setSessionClearKey((prev) => prev + 1);
    setIsSessionSearchFocused(false);
  }, []);

  const handleSessionSearchChange = useCallback((text: string) => {
    setSessionSearchQuery(text);
  }, []);

  const handleDismissSessionSearch = useCallback(() => {
    // Increment clear key to force SwiftUI TextField to remount, dropping focus
    setSessionClearKey((prev) => prev + 1);
    setIsSessionSearchFocused(false);
  }, []);

  // Track keyboard visibility while sessions panel is open for search focus state
  useEffect(() => {
    if (!isSessionsPanelOpen) {
      setIsSessionSearchFocused(false);
      return;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setIsSessionSearchFocused(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setIsSessionSearchFocused(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isSessionsPanelOpen]);

  // ===========================
  // RENDER
  // ===========================

  // Calculate header title width (matching payments pattern)
  const headerTitleWidth = screenWidth - 124 - 24;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}>
      <Screen name="UserMessagesScreen">
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: false,
            headerStyle: { backgroundColor: surfaceSecondary },
            headerShadowVisible: false,
            headerBackVisible: false,
            headerTintColor: foreground,
            headerLeft: () =>
              isRoutstrMode ? (
                <Pressable
                  onPress={
                    isSessionsPanelOpen
                      ? handleCloseSessionsPanel
                      : () => setIsSessionsPanelOpen(true)
                  }
                  style={{ padding: 8 }}>
                  <Icon name={'mdi:menu'} size={24} color={foreground} />
                </Pressable>
              ) : (
                <Pressable onPress={handleBack} style={{ padding: 8 }}>
                  <Icon name="material-symbols:arrow-back-rounded" size={24} color={foreground} />
                </Pressable>
              ),
            headerTitle: () =>
              isSessionsPanelOpen && isRoutstrMode ? (
                <GlassSearchBar
                  width={headerTitleWidth}
                  clearKey={sessionClearKey}
                  onChangeText={handleSessionSearchChange}
                  placeholder="Search sessions..."
                  keyboardType="web-search"
                />
              ) : Platform.OS === 'ios' && isRoutstrMode ? (
                <Host matchContents={false} style={{ width: headerTitleWidth, height: 48 }}>
                  <ContextMenu>
                    <ContextMenu.Items>
                      <SwiftUIButton
                        systemImage="arrow.clockwise"
                        label="Refresh Balance"
                        onPress={handleRefreshBalance}
                      />
                      <SwiftUIButton
                        systemImage="creditcard"
                        label="Top Up Balance"
                        onPress={() => handleTopUp()}
                      />
                      <SwiftUIButton
                        systemImage="cpu"
                        label="Switch Model"
                        onPress={() => setIsModelSwitchBottomSheetOpen(true)}
                      />
                      <SwiftUIButton
                        systemImage="square.stack"
                        label="View Sessions"
                        onPress={() => setIsSessionsPanelOpen(true)}
                      />
                      <SwiftUIButton
                        systemImage="plus.square"
                        label="New Session"
                        onPress={handleNewSession}
                      />
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
                            placeholder="Display Name"
                            size={16}
                            bold
                            style={{
                              color: foreground,
                              textAlign: 'left',
                            }}>
                            {displayName}
                          </Text>
                          <HStack
                            align="center"
                            justify="flex-start"
                            spacing={4}
                            style={{ marginTop: 2 }}>
                            {getAnonymousMode() && (
                              <Icon
                                name="mdi:anonymous"
                                size={14}
                                color={shade400}
                                className="border-r-shade-300 border-r-[1.5px] pr-1"
                              />
                            )}
                            <Icon
                              name="material-symbols:account-balance-wallet"
                              size={14}
                              color={shade400}
                            />
                            <Text overpass size={12} style={{ color: shade400 }}>
                              {formatBalance(balance)}
                            </Text>
                            <Spacer size={4} />
                            <Icon name="mdi:robot" size={14} color={shade400} />
                            <Text size={12} style={{ color: shade400 }} numberOfLines={1}>
                              {selectedModelName || selectedModel || 'gpt-3.5-turbo'}
                            </Text>
                          </HStack>
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
                    width: headerTitleWidth,
                    height: 48,
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
                    {isRoutstrMode ? (
                      <HStack align="center" justify="flex-start">
                        <Icon
                          name="material-symbols:account-balance-wallet"
                          size={14}
                          color={shade400}
                        />
                        <Text overpass size={12} style={{ color: shade400 }}>
                          {formatBalance(balance)}
                        </Text>
                        <Icon name="mdi:robot" size={14} color={shade400} />
                        <Text size={12} style={{ color: shade400 }} numberOfLines={1}>
                          {selectedModelName || selectedModel || 'gpt-3.5-turbo'}
                        </Text>
                      </HStack>
                    ) : (
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
                    )}
                  </VStack>
                </View>
              ),
            headerRight: () =>
              isSessionsPanelOpen && isRoutstrMode && isSessionSearchFocused ? (
                <Pressable onPress={handleDismissSessionSearch} style={{ padding: 8 }}>
                  <Icon name="material-symbols:close-rounded" size={20} color={foreground} />
                </Pressable>
              ) : isRoutstrMode ? (
                messages.length > 0 && !getAnonymousMode() ? (
                  <Pressable onPress={handleNewSession} style={{ padding: 8 }}>
                    <Icon name="lucide:square-pen" size={20} color={foreground} />
                  </Pressable>
                ) : (
                  <Pressable onPress={toggleAnonymousMode} style={{ padding: 8 }}>
                    <Icon
                      name={getAnonymousMode() ? 'mdi:anonymous' : 'mdi:anonymous-off'}
                      size={20}
                      color={foreground}
                    />
                  </Pressable>
                )
              ) : (
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
                isPresented={isAttachmentsBottomSheetOpen}
                onIsPresentedChange={setIsAttachmentsBottomSheetOpen}>
                <VStack spacing={16} style={{ padding: 20 }}>
                  <Pressable
                    onPress={() => {
                      setIsAttachmentsBottomSheetOpen(false);
                      router.navigate('/camera');
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 16,
                      backgroundColor: surfaceSecondary,
                      borderRadius: 12,
                    }}>
                    <Icon name="proicons:photo" size={24} color={foreground} />
                    <Text size={16} style={{ color: foreground, marginLeft: 12 }} bold>
                      Camera
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setIsAttachmentsBottomSheetOpen(false);
                      photoPickerComingSoonPopup();
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 16,
                      backgroundColor: surfaceSecondary,
                      borderRadius: 12,
                    }}>
                    <Icon name="proicons:photo" size={24} color={foreground} />
                    <Text size={16} style={{ color: foreground, marginLeft: 12 }} bold>
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
                      backgroundColor: surfaceSecondary,
                      borderRadius: 12,
                    }}>
                    <Icon name="lucide:square-pen" size={24} color={foreground} />
                    <Text size={16} style={{ color: foreground, marginLeft: 12 }} bold>
                      New Session
                    </Text>
                  </Pressable>
                </VStack>
              </BottomSheet>
            </Host>
          )}

          {/* Model Switch Bottom Sheet */}
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
                isPresented={isModelSwitchBottomSheetOpen}
                onIsPresentedChange={setIsModelSwitchBottomSheetOpen}>
                <VStack spacing={16} style={{ paddingTop: 20, paddingBottom: 40, flex: 1 }}>
                  <Text size={20} bold style={{ color: foreground, paddingHorizontal: 16 }}>
                    Select Model
                  </Text>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Host matchContents style={{ width: screenWidth }}>
                      <SwiftUIHStack
                        spacing={12}
                        alignment="center"
                        modifiers={[padding({ leading: 16, trailing: 16, top: 8, bottom: 8 })]}>
                        {uniqueProviders.map((provider) => (
                          <SwiftUIButton
                            key={provider}
                            label={provider}
                            onPress={() => setSelectedProvider(provider)}
                            modifiers={[
                              buttonStyle('plain'),
                              padding({ horizontal: 12, vertical: 8 }),
                              background(selectedProvider === provider ? muted : accent),
                              cornerRadius(8),
                              fixedSize({ horizontal: true, vertical: false }),
                            ]}
                          />
                        ))}
                      </SwiftUIHStack>
                    </Host>
                  </ScrollView>

                  {filteredModels.length > 0 ? (
                    <View style={{ flex: 1, height: 500 }}>
                      <LegendList
                        data={filteredModels}
                        renderItem={renderModelItem}
                        keyExtractor={(item: RoutstrModel) => item.id}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingBottom: 20 }}
                        waitForInitialLayout={true}
                        recycleItems
                        getFixedItemSize={() => 96}
                        drawDistance={260}
                      />
                    </View>
                  ) : (
                    <VStack
                      spacing={12}
                      align="center"
                      style={{ padding: 20, justifyContent: 'center', alignItems: 'center' }}>
                      <Text size={14} style={{ color: shade400 }}>
                        {apiKey ? 'Loading models...' : 'No API key configured'}
                      </Text>
                      <Pressable
                        onPress={loadModels}
                        style={{
                          marginTop: 12,
                          backgroundColor: defaultColor,
                          borderRadius: 8,
                          paddingVertical: 8,
                          paddingHorizontal: 16,
                        }}>
                        <Text size={14} bold style={{ color: foreground }}>
                          Retry
                        </Text>
                      </Pressable>
                    </VStack>
                  )}
                </VStack>
              </BottomSheet>
            </Host>
          )}

          {/* Messages */}
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
              renderItem={({ item }: { item: any }) => (
                <MessageBubble
                  message={item}
                  isMe={item.sender === 'me'}
                  userPicture={item.sender === 'other' ? userPicture : undefined}
                  userName={displayName}
                  myName={myName}
                  isLoadingMetadata={shouldShowAvatarLoading}
                  isStreaming={streamingMessageId === item.id}
                />
              )}
              keyExtractor={(item: any) => item.id}
              initialScrollAtEnd
              maintainScrollAtEnd
              maintainScrollAtEndThreshold={0.2}
              alignItemsAtEnd
              estimatedItemSize={80}
              recycleItems={false}
              style={{ flex: 1 }}
              contentContainerStyle={{
                padding: 16,
                paddingBottom:
                  (isRoutstrMode && (balance === null || balance < 1000)) ||
                  (!isRoutstrMode && lud16)
                    ? 70
                    : 16,
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

          {/* Input Area */}
          <View
            style={{
              backgroundColor: surfaceSecondary,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom,
              borderTopWidth: 1,
              borderTopColor: surfaceTertiary,
            }}>
            <HStack align="center" spacing={12}>
              {isRoutstrMode ? (
                <Pressable
                  onPress={() => setIsAttachmentsBottomSheetOpen(true)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: surfaceTertiary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Icon name="fluent:add-24-filled" size={24} color={foreground} />
                </Pressable>
              ) : (
                <Avatar
                  size={40}
                  seed={nostrKeys?.pubkey}
                  picture={myProfile.picture}
                  name={myName}
                />
              )}

              <TextInput
                value={messageText}
                onChangeText={setMessageText}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  backgroundColor: surfaceTertiary,
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
                  color={messageText.trim() && !isSending ? foreground : shade500}
                />
              </Pressable>
            </HStack>
          </View>

          {/* Action Buttons - Floating above input */}
          {((isRoutstrMode && (balance === null || balance < 1000)) ||
            (!isRoutstrMode && lud16)) && (
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                bottom: insets.bottom + 60,
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
                {isRoutstrMode && (balance === null || balance < 1000) && (
                  <Button
                    variant="primary"
                    text="Top Up Balance"
                    icon={<Icon name="solar:wallet-bold" size={20} color={surface} />}
                    onPress={() => handleTopUp()}
                    style={{ paddingHorizontal: 16 }}
                  />
                )}
                {!isRoutstrMode && lud16 && (
                  <Button
                    variant="primary"
                    text="Send Money"
                    icon={<Icon name="mingcute:lightning-fill" size={20} color={surface} />}
                    onPress={handleSendMoney}
                    style={{ paddingHorizontal: 16 }}
                  />
                )}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Sessions Panel */}
        {isRoutstrMode && (
          <SessionsPanel
            isOpen={isSessionsPanelOpen}
            onClose={handleCloseSessionsPanel}
            onSessionSelect={() => {}}
            onNewSession={handleNewSession}
            searchQuery={sessionSearchQuery}
            onRefreshBalance={handleRefreshBalance}
            onTopUp={() => handleTopUp()}
            onSwitchModel={() => setIsModelSwitchBottomSheetOpen(true)}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
