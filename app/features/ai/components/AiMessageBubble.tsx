import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import * as Clipboard from 'expo-clipboard';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'assets/icons';
import type { ChatAttachment, RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { Text } from '@/shared/ui/primitives/Text';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { popup } from '@/shared/lib/popup';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { formatRelative } from '@/shared/lib/date';
import { duration } from '@/shared/styles/tokens';
import {
  useStreamingContent,
  useStreamingReasoning,
  useStreamingStartedAt,
} from '../lib/streamingBuffer';
import opacity from 'hex-color-opacity';

/** Active-branch widget data for one assistant message. Provided by the
 *  screen, which owns the conversation tree and the `setActiveBranch`
 *  store action. Absent when the message has no siblings. */
export interface BranchNav {
  /** 1-based current sibling index. */
  index: number;
  /** Sibling count. */
  total: number;
  /** Switch to the previous sibling, or `undefined` when already first. */
  onPrev?: () => void;
  /** Switch to the next sibling, or `undefined` when already last. */
  onNext?: () => void;
}

interface AiMessageBubbleProps {
  message: RoutstrMessage;
  isStreaming?: boolean;
  /** Invoked with the message id when the user taps Retry. Omit to hide the
   *  Retry action (e.g. while another message is mid-stream). */
  onRetry?: (messageId: string) => void;
  /** When set, render the `←  N / M  →` branch navigator on this bubble. */
  branchNav?: BranchNav;
}

/**
 * Build the textual prefix for the thinking-header label. Returns only
 * the duration phrase — the cost segment is rendered separately by the
 * JSX via `<AmountFormatter />`, so it picks up the user's BTC / ⚡ / sats
 * display preference (matching the balance pill at the top of the AI tab)
 * instead of producing a divergent `formatAmount` string.
 *
 *  - Live (mid-stream): present tense, "Thinking…" → "Thinking for N seconds".
 *  - Finalised: past tense, "Thought briefly" / "Thought for N seconds".
 */
function buildThinkingPrefix(durationSec: number | undefined, isLive: boolean): string {
  const seconds = durationSec ?? 0;
  if (seconds < 1) return isLive ? 'Thinking…' : 'Thought briefly';
  const verb = isLive ? 'Thinking' : 'Thought';
  return `${verb} for ${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * Tick a 1Hz counter while `startedAtMs` is non-null. Returns the whole
 * seconds elapsed since `startedAtMs` (or 0 once the stream ends). The
 * interval auto-cleans up when the value flips back to `null`, so idle
 * bubbles never burn timers.
 */
function useElapsedSeconds(startedAtMs: number | null): number {
  // The state value is the most recent computed elapsed-second integer —
  // we deliberately store the integer (not just a tick counter) so React
  // bails out of re-renders inside the same second window.
  const [seconds, setSeconds] = useState<number>(() =>
    startedAtMs == null ? 0 : Math.floor((Date.now() - startedAtMs) / 1000)
  );
  useEffect(() => {
    if (startedAtMs == null) {
      setSeconds(0);
      return;
    }
    setSeconds(Math.floor((Date.now() - startedAtMs) / 1000));
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [startedAtMs]);
  return seconds;
}

interface ThinkingHeaderProps {
  /** True while the bubble is the active streaming target. */
  isLive: boolean;
  /** Live elapsed seconds (when `isLive`) or finalised duration (when not). */
  seconds: number | undefined;
  costSats: number | undefined;
  reasoning: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  testID: string;
  color: string;
}

/**
 * Single header that owns BOTH "currently thinking" and "thought for N
 * seconds" states — replaces the prior split between `ThinkingDots` and
 * the standalone brain-icon line. The icon is a spinning loader while
 * `isLive`, otherwise a brain glyph; the label flips between present
 * ("Thinking for…") and past ("Thought for…") tense; reasoning text
 * streams underneath when expanded.
 */
function ThinkingHeader({
  isLive,
  seconds,
  costSats,
  reasoning,
  expanded,
  onToggleExpanded,
  testID,
  color,
}: ThinkingHeaderProps) {
  const prefix = buildThinkingPrefix(seconds, isLive);
  const hasReasoning = reasoning.length > 0;
  // Cost only renders post-stream — mid-stream we don't have it yet, since
  // the balance-diff is computed in the post-stream `checkBalance` resolve.
  const showCost = !isLive && costSats != null && costSats > 0;

  const headerRow = (
    <HStack align="center" spacing={4}>
      {isLive ? (
        <Spinner size={14} color={color} />
      ) : (
        <Icon name="mdi:brain" size={14} color={color} />
      )}
      <Text size={13} style={{ color, fontStyle: 'italic' }}>
        {prefix}
      </Text>
      {showCost ? (
        <>
          <Text size={13} style={{ color, fontStyle: 'italic' }}>
            • cost
          </Text>
          {/* Same component the balance pill uses, so this respects the
              user's BTC / ⚡ / sats display preference and renders in the
              MonaSans family. Sized to match the surrounding label so the
              row stays one visual line. The extra `marginLeft` adds a
              little breath between the italic "cost" word and the
              MonaSans-rendered amount — the parent HStack's 4px spacing
              alone leaves them visually crammed because the two glyph
              families have very different side-bearings. */}
          <AmountFormatter
            amount={costSats as number}
            unit="sat"
            size={13}
            weight="medium"
            color={color}
            style={{ marginLeft: 4 }}
          />
        </>
      ) : null}
      {hasReasoning ? (
        <Icon name={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} size={14} color={color} />
      ) : null}
    </HStack>
  );

  // Reasoning text is collapsible — tapping the row toggles. While streaming
  // the parent auto-expands so the user sees the model's thought process
  // arriving in real time.
  if (!hasReasoning) return headerRow;

  return (
    <Pressable
      onPress={onToggleExpanded}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide reasoning' : 'Show reasoning'}
      accessibilityState={{ expanded }}>
      {headerRow}
      {expanded ? (
        <Text size={13} style={{ color, lineHeight: 18, marginTop: 4 }}>
          {reasoning}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Thumbnail for one persisted image attachment. Renders from the bounded
 * local URI only (base64 never persists); when the file is gone — photo
 * deleted, or iOS rotated the app container across a reinstall — the
 * `onError` flip shows a broken-image placeholder instead of a blank box.
 */
function AttachmentThumb({ attachment }: { attachment: ChatAttachment }) {
  const shade400 = useThemeColor('shade-400');
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  if (failed) {
    return (
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name="mdi:image-broken-variant" size={28} color={shade400} />
      </View>
    );
  }
  return (
    <ExpoImage
      source={{ uri: attachment.localUri }}
      style={{ width: 96, height: 96, borderRadius: 12 }}
      contentFit="cover"
      onError={onError}
      accessibilityLabel="Image attachment"
    />
  );
}

function UserBubble({ message }: { message: RoutstrMessage }) {
  const [foreground, surfaceSecondary, shade400, shade500] = useThemeColor([
    'foreground',
    'surface-secondary',
    'shade-400',
    'shade-500',
  ] as const);
  const isSending = message.pending === true;
  const attachments = message.attachments ?? [];
  return (
    <VStack align="flex-end" spacing={2} style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
      {attachments.length > 0 ? (
        <HStack align="center" spacing={6} style={{ marginTop: 6 }}>
          {attachments.map((attachment, index) => (
            <AttachmentThumb key={`${attachment.localUri}-${index}`} attachment={attachment} />
          ))}
        </HStack>
      ) : null}
      <View
        style={{
          marginVertical: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          backgroundColor: surfaceSecondary,
          opacity: isSending ? 0.6 : 1,
        }}>
        <Text size={16} style={{ color: foreground, lineHeight: 22 }}>
          {message.content}
        </Text>
      </View>
      <HStack align="center" spacing={4} style={{ marginRight: 4, marginBottom: 4 }}>
        <Text size={11} style={{ color: shade400 }}>
          {formatRelative(message.timestamp, 'chat-bubble')}
        </Text>
        {isSending ? (
          <Spinner size={12} color={shade500} />
        ) : (
          <Icon name="simple-line-icons:check" size={12} color={shade500} />
        )}
      </HStack>
    </VStack>
  );
}

interface BranchNavViewProps extends BranchNav {
  color: string;
  testIdPrefix: string;
}

/** `←  2 / 3  →` widget shown beneath assistant messages with siblings.
 *  Tapping a chevron flips `activeChildren` for the parent, which causes
 *  the chat list to re-derive onto the chosen branch. */
function BranchNavView({ index, total, onPrev, onNext, color, testIdPrefix }: BranchNavViewProps) {
  // Chevrons are intentionally chunky (20pt glyph + 14pt hitSlop ≈ 48pt
  // tap target) so the prev / next controls clear the iOS HIG 44pt
  // minimum without taking visible space from the bubble.
  return (
    <HStack align="center" spacing={8}>
      <Pressable
        onPress={onPrev}
        disabled={!onPrev}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Previous response"
        accessibilityState={{ disabled: !onPrev }}
        testID={`${testIdPrefix}-branch-prev`}>
        <Icon name="mdi:chevron-left" size={20} color={onPrev ? color : opacity(color, 0.35)} />
      </Pressable>
      <Text size={12} style={{ color, fontVariant: ['tabular-nums'] }}>
        {index} / {total}
      </Text>
      <Pressable
        onPress={onNext}
        disabled={!onNext}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Next response"
        accessibilityState={{ disabled: !onNext }}
        testID={`${testIdPrefix}-branch-next`}>
        <Icon name="mdi:chevron-right" size={20} color={onNext ? color : opacity(color, 0.35)} />
      </Pressable>
    </HStack>
  );
}

function AssistantBubble({ message, isStreaming, onRetry, branchNav }: AiMessageBubbleProps) {
  const [foreground, shade400] = useThemeColor(['foreground', 'shade-400'] as const);

  // While streaming, the bubble for the in-flight assistant message reads
  // its live text + reasoning + start-time from the module-level buffer
  // instead of the persisted store. Other bubbles' streaming-buffer
  // hooks return null and they don't re-render.
  const liveContent = useStreamingContent(message.id);
  const liveReasoning = useStreamingReasoning(message.id);
  const liveStartedAt = useStreamingStartedAt(message.id);

  // `isLive` is gated on the prop coming from the chat screen (canonical
  // truth: "is this id the screen's `streamingMessageId`?") AND on the
  // buffer having a start timestamp. Either flipping false drops us out
  // of live mode, which prevents a stale buffer entry from showing a
  // running timer on an already-finalised bubble.
  const isLive = isStreaming === true && liveStartedAt != null;
  const elapsedSeconds = useElapsedSeconds(isLive ? liveStartedAt : null);

  const displayedContent = liveContent ?? message.content;
  // Persisted reasoning is the source of truth once the stream ends. Mid-
  // stream we prefer the live channel so reasoning tokens render as they
  // arrive instead of appearing all at once on completion.
  const displayedReasoning = isLive ? (liveReasoning ?? '') : (message.reasoningContent ?? '');

  const hasContent = displayedContent.length > 0;
  const hasReasoning = displayedReasoning.length > 0;

  // Header shows whenever:
  //   • we're actively streaming this bubble (live counter + spinner),
  //   • OR the persisted message accumulated thinking duration / reasoning.
  // Otherwise we'd flash an empty bubble with no header.
  const showHeader = isLive || message.thinkingDurationSec != null || hasReasoning;

  // Persist-side seconds when the stream is no longer live, live-tick seconds
  // while it is. The user wanted "exactly how long it's thinking for" — this
  // is that counter.
  const headerSeconds = isLive ? elapsedSeconds : message.thinkingDurationSec;

  // Auto-expand reasoning while streaming so the user sees the model's
  // chain of thought in real time. After the stream finishes, collapse so
  // historical reasoning doesn't pad out the chat list. The user can
  // override either default by tapping the row.
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  // Track whether the user has manually toggled during this stream — once
  // they have, we stop auto-syncing so we don't fight their choice.
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (userToggledRef.current) return;
    setReasoningExpanded(isLive);
  }, [isLive]);
  // When a new stream starts (the message becomes live again — happens on
  // retry), reset the user's manual override.
  useEffect(() => {
    if (isLive) userToggledRef.current = false;
  }, [isLive]);

  const handleToggleReasoning = useCallback(() => {
    userToggledRef.current = true;
    setReasoningExpanded((v) => !v);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!displayedContent) return;
    await Clipboard.setStringAsync(displayedContent);
    popup({ message: 'Copied', icon: 'icon:lets-icons:copy', type: 'success' });
  }, [displayedContent]);

  const handleRetry = useCallback(() => {
    if (!onRetry) return;
    onRetry(message.id);
  }, [onRetry, message.id]);

  const showActions = hasContent && !isStreaming;

  return (
    <View style={{ alignSelf: 'stretch', marginVertical: 8, paddingHorizontal: 4 }}>
      <VStack spacing={6} align="flex-start">
        {showHeader ? (
          <ThinkingHeader
            isLive={isLive}
            seconds={headerSeconds}
            costSats={message.costSats}
            reasoning={displayedReasoning}
            expanded={reasoningExpanded}
            onToggleExpanded={handleToggleReasoning}
            testID={`ai-message-reasoning-${message.id}`}
            color={shade400}
          />
        ) : null}

        {hasContent ? (
          <Text size={16} style={{ color: foreground, lineHeight: 24 }}>
            {displayedContent}
            {isStreaming ? (
              <Text size={16} style={{ color: opacity(foreground, 0.5) }}>
                {' ▍'}
              </Text>
            ) : null}
          </Text>
        ) : null}

        {/* Action row: Copy + Retry on the left, branch nav pinned to the
            right edge of the bubble. Right-aligning the chevrons gives the
            user a clean horizontal gap between Retry and the prev arrow so
            it's easier to land a finger on the small chevron targets. The
            row is hidden while the bubble is mid-stream so the user can't
            kick off a sibling that races with the in-flight write. Copy
            alone stays visible so partial output can be copied — see the
            previous rev's comment about why we no longer gate Copy on
            `!isStreaming`. */}
        {hasContent ? (
          <HStack
            align="center"
            justify="space-between"
            style={{ marginTop: 4, alignSelf: 'stretch' }}>
            <HStack align="center" spacing={12}>
              <Pressable
                onPress={handleCopy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Copy response"
                testID={`ai-message-copy-${message.id}`}>
                <HStack align="center" spacing={4}>
                  <Icon name="lets-icons:copy" size={16} color={opacity(foreground, 0.6)} />
                  <Text size={12} style={{ color: opacity(foreground, 0.6) }}>
                    Copy
                  </Text>
                </HStack>
              </Pressable>

              {showActions && onRetry ? (
                <Pressable
                  onPress={handleRetry}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Regenerate response"
                  testID={`ai-message-retry-${message.id}`}>
                  <HStack align="center" spacing={4}>
                    <Icon name="mdi:refresh" size={16} color={opacity(foreground, 0.6)} />
                    <Text size={12} style={{ color: opacity(foreground, 0.6) }}>
                      Retry
                    </Text>
                  </HStack>
                </Pressable>
              ) : null}
            </HStack>

            {showActions && branchNav ? (
              <BranchNavView
                {...branchNav}
                color={opacity(foreground, 0.6)}
                testIdPrefix={`ai-message-${message.id}`}
              />
            ) : null}
          </HStack>
        ) : null}
      </VStack>
    </View>
  );
}

/**
 * Single chat-message bubble for the AI tab.
 *
 * - User messages render as a filled pill on the right.
 * - Assistant messages render as full-width prose on the left, prefixed by
 *   a unified thinking-header that:
 *     • shows a spinner + live "Thinking for N seconds" counter while the
 *       bubble is the active stream target,
 *     • flips to a brain icon + "Thought for N seconds • cost X sats" once
 *       the stream finalises,
 *     • streams the model's chain-of-thought reasoning underneath (auto-
 *       expanded mid-stream, collapsed afterwards, user can override).
 *   Once content arrives, a Copy / Retry / branch-nav row appears beneath.
 *
 * Split into two components so user bubbles don't subscribe to the streaming
 * buffer (every chunk would otherwise fan out to every fiber's
 * `useSyncExternalStore` getter, just to return null).
 */
export function AiMessageBubble(props: AiMessageBubbleProps) {
  return props.message.role === 'user' ? (
    <UserBubble message={props.message} />
  ) : (
    <AssistantBubble {...props} />
  );
}
