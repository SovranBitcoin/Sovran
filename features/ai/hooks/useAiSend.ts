import { useCallback, useState } from 'react';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { router } from 'expo-router';
import { sendMessage, checkBalance } from '@/shared/lib/routstr/api';
import {
  actionMenuPopup,
  modelSwitchedPopup,
  noApiKeyPopup,
  noWalletAvailablePopup,
  sendMessageFailedPopup,
} from '@/shared/lib/popup';
import { aiLog } from '@/shared/lib/logger';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import {
  AFFORD_BUFFER,
  AUTO_ICON,
  getAffordabilityDetails,
  getModelDisplayName,
  getProviderById,
  getTierById,
  resolveCandidateChainForSlot,
  resolveSelectedModel,
} from '../lib/format';
import { deriveActivePath, getAncestorsExclusive } from '../lib/branching';
import {
  clearStreaming,
  setStreamingReasoning,
  setStreamingText,
  startStreaming,
} from '../lib/streamingBuffer';

interface SendStatus {
  isSending: boolean;
  streamingMessageId: string | null;
}

/** Minimum interval between streaming-token haptics. Streamers can fire >50
 * tokens/sec; without throttling the device feels like a buzzing wall. 80ms
 * gives a present "typewriter" feel without being aggressive. */
const HAPTIC_THROTTLE_MS = 80;

/** Periodic in-stream telemetry interval. We report rolling chunk/char/gap
 * stats this often instead of per chunk — per-chunk logs would dedup-collapse
 * (50ms window in `createLogger`) but the bigger problem is signal:noise:
 * `log-doctor stats` flags any event >15% of total logs as noise. */
const STREAM_PROGRESS_INTERVAL_MS = 500;

/** Inter-chunk gap (ms) above which we emit a `ai.stream.stall` warn — these
 * are the spikes that cause the visible "burst then pause" feel during a
 * stream. Tuned from iOS reanimated keyboard-controller's typical idle gap. */
const STREAM_STALL_THRESHOLD_MS = 500;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whether a connect-time failure should bump the request to the next
 * candidate model in the same tier. Auth (401), payment (402), and rate
 * limit (429) all repeat across providers — retrying just wastes balance.
 * Network failures and gateway/server errors (502/503/504/500) are the
 * cases where the next provider in the tier is genuinely worth a shot.
 *
 * Mid-stream errors are NOT retried here: by then the assistant placeholder
 * has shown to the user and we'd have to discard partial state.
 */
function isRetryableConnectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (status == null) return false;
  if (status === 0) return true; // network_error / fetch threw
  return status >= 500 && status <= 599;
}

/**
 * Encapsulates the routstr send + stream + balance-refresh flow for the AI
 * tab. Two entry points share the same streaming core:
 *
 *   - `send(text)` appends a new user message under the current active leaf
 *     and streams the assistant reply.
 *   - `retry(messageId)` spawns a *sibling* assistant under the same parent
 *     as `messageId` and streams a fresh response. The returned active
 *     branch flips to the new sibling so the chat list re-derives onto the
 *     new branch immediately.
 *
 * Both flows:
 *   - Stream tokens through the module-level `streamingBuffer` instead of
 *     `routstrStore.updateMessage`, so per-token AsyncStorage writes are
 *     avoided (those caused the "sudden reveal" lag).
 *   - Persist the final assistant payload (content + reasoning + thinking
 *     duration + cost) in ONE atomic write via `finalizeAssistantMessage`,
 *     preserving the placeholder's id / parentId / role / timestamp.
 *   - Walk the tier candidate list on connect-time failures (5xx/network)
 *     to fall through to the next provider before surfacing an error.
 *   - Snapshot balance before send, compute `costSats` from the post-stream
 *     `checkBalance()` diff, and stamp it on the message asynchronously.
 *   - Cashu-token-redeem flow is intentionally out of scope (still lives in
 *     `UserMessagesScreen`).
 */
export function useAiSend() {
  const [status, setStatus] = useState<SendStatus>({
    isSending: false,
    streamingMessageId: null,
  });

  const apiKey = useRoutstrStore((s) => s.apiKey);
  const isAnonymous = useRoutstrStore((s) => s.isAnonymousMode);
  const currentSessionId = useRoutstrStore((s) => s.currentSessionId);
  const createSession = useRoutstrStore((s) => s.createSession);
  const addMessage = useRoutstrStore((s) => s.addMessage);
  const removeMessages = useRoutstrStore((s) => s.removeMessages);
  const finalizeAssistantMessage = useRoutstrStore((s) => s.finalizeAssistantMessage);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);
  const setBalance = useRoutstrStore((s) => s.setBalance);
  const setSelectedSlot = useRoutstrStore((s) => s.setSelectedSlot);
  const updateCurrentSessionTitle = useRoutstrStore((s) => s.updateCurrentSessionTitle);

  const { keys: nostrKeys } = useNostrKeysContext();

  const navigateToTopUp = useCallback(
    (pendingMessage: string) => {
      if (!nostrKeys?.pubkey) {
        noWalletAvailablePopup();
        return;
      }
      useRoutstrTopUpStore.getState().start(pendingMessage);
      const preferredMint = useMintStore.getState().getSelectedMint(nostrKeys.pubkey) ?? '';
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
    },
    [nostrKeys?.pubkey]
  );

  /**
   * Drives a single placeholder assistant message to completion: walks the
   * candidate chain, streams tokens into `streamingBuffer`, finalises the
   * persisted message, and stamps cost asynchronously off the post-stream
   * balance diff. Both `send` and `retry` funnel through here.
   */
  const streamIntoPlaceholder = useCallback(
    async (params: {
      assistantMessageId: string;
      apiMessages: { role: 'user' | 'assistant' | 'system'; content: string }[];
      flowId: string;
      retriedFromMessageId?: string;
      pendingUserMessageForTopUp: string;
    }) => {
      const { assistantMessageId, apiMessages, flowId, pendingUserMessageForTopUp } = params;
      if (!apiKey) {
        noApiKeyPopup();
        return;
      }

      const storeState = useRoutstrStore.getState();
      const balanceBeforeMsats = storeState.balance ?? 0;
      const balanceSats = Math.floor(balanceBeforeMsats / 1000);
      const tier = getTierById(storeState.selectedTier);
      const provider = getProviderById(storeState.selectedProvider);
      const cachedModels = storeState.modelsCache?.data ?? [];
      // Resolve the (provider, tier) pair against the live catalog, then
      // take the affordable head of the same-tier chain across the other
      // providers as runtime fallback for connect-time failures.
      const primaryModel = resolveSelectedModel(provider.id, tier.id, balanceSats, cachedModels);
      const allCandidates = resolveCandidateChainForSlot(provider.id, tier.id, cachedModels);
      const primaryIdx = allCandidates.indexOf(primaryModel);
      const candidateChain =
        primaryIdx >= 0 ? allCandidates.slice(primaryIdx) : [primaryModel, ...allCandidates];

      setStatus({ isSending: true, streamingMessageId: assistantMessageId });
      // Captures `Date.now()` for the live "Thinking for X seconds"
      // counter rendered by the bubble. Resets text + reasoning channels
      // so a previous stream's tail can't leak into this one.
      startStreaming(assistantMessageId);

      // Hoisted so the catch block (402 popup) can reference whichever
      // candidate we were last attempting when the request failed.
      let modelToUse = primaryModel;

      const span = aiLog.startSpan('ai.send', {
        flowId,
        tier: tier.id,
        provider: provider.id,
        model: primaryModel,
        candidateCount: candidateChain.length,
        balanceSats,
        retried: params.retriedFromMessageId ?? null,
      });

      try {
        const apiInputChars = apiMessages.reduce((n, m) => n + m.content.length, 0);
        const sendStart = performance.now();
        aiLog.info('ai.send.request', {
          flowId,
          tier: tier.id,
          provider: provider.id,
          primaryModel,
          candidates: candidateChain,
          historyMessages: apiMessages.length,
          totalInputChars: apiInputChars,
        });

        // Pre-flight diagnostic: every input the affordability gate
        // considered, plus the raw `/models` row for each candidate. If a
        // request goes through despite the chip claiming the tier was
        // unaffordable, this is the comparison point for `max_cost` vs
        // actual cost (logged later as `ai.send.actual_cost`).
        const candidateSnapshots = candidateChain.map((id) => {
          const model = cachedModels.find((m) => m.id === id);
          return {
            ...getAffordabilityDetails(id, balanceSats, cachedModels),
            catalogEntryFound: !!model,
            sats_pricing: model?.sats_pricing ?? null,
            pricing: model?.pricing ?? null,
            context_length: model?.context_length ?? null,
            enabled: model?.enabled ?? null,
          };
        });
        aiLog.info('ai.send.affordability_check', {
          flowId,
          balanceMsats: balanceBeforeMsats,
          balanceSats,
          selectedTier: tier.id,
          selectedProvider: provider.id,
          buffer: AFFORD_BUFFER,
          catalogSize: cachedModels.length,
          candidates: candidateSnapshots,
        });

        let stream: AsyncIterable<any> | undefined;
        let lastConnectErr: unknown = null;
        for (let i = 0; i < candidateChain.length; i++) {
          const candidate = candidateChain[i];
          try {
            const result = await sendMessage(apiKey, apiMessages, {
              model: candidate,
              temperature: 0.7,
              stream: true,
            });
            stream = result.stream;
            modelToUse = candidate;
            if (i > 0) {
              aiLog.warn('ai.send.fallback_used', {
                flowId,
                tier: tier.id,
                provider: provider.id,
                attemptedIndex: i,
                primaryModel,
                fellBackTo: candidate,
              });
            }
            break;
          } catch (err) {
            lastConnectErr = err;
            if (!isRetryableConnectError(err) || i === candidateChain.length - 1) throw err;
            aiLog.warn('ai.send.candidate_failed', {
              flowId,
              tier: tier.id,
              provider: provider.id,
              candidate,
              status: (err as { status?: number })?.status,
              nextCandidate: candidateChain[i + 1],
            });
          }
        }
        aiLog.info('ai.stream.connection', {
          flowId,
          model: modelToUse,
          ttfb_ms: r2(performance.now() - sendStart),
        });

        if (!stream) throw lastConnectErr ?? new Error('Stream not available');

        let fullContent = '';
        let fullReasoning = '';
        let chunkCount = 0;
        let chunksWithContent = 0;
        let chunksWithReasoning = 0;
        let thinkingSec = 0;
        let lastHapticAt = 0;
        let lastChunkAt = 0;
        let lastProgressAt = sendStart;
        let lastProgressChunks = 0;
        let lastProgressChars = 0;
        let firstChunkAt = 0;
        let firstContentAt = 0;
        let firstReasoningAt = 0;
        let maxGap = 0;
        let stallCount = 0;

        for await (const chunk of stream) {
          chunkCount++;
          const now = performance.now();
          const gap = lastChunkAt === 0 ? 0 : now - lastChunkAt;
          if (gap > maxGap) maxGap = gap;
          if (lastChunkAt !== 0 && gap > STREAM_STALL_THRESHOLD_MS) {
            stallCount++;
            aiLog.warn('ai.stream.stall', {
              flowId,
              gap_ms: r2(gap),
              afterChunk: chunkCount - 1,
              charsBefore: fullContent.length,
            });
          }
          lastChunkAt = now;

          if (firstChunkAt === 0) {
            firstChunkAt = now;
            aiLog.info('ai.stream.first_chunk', {
              flowId,
              ttfc_ms: r2(now - sendStart),
            });
          }

          const delta = chunk.choices?.[0]?.delta;
          const content =
            delta?.content || (delta as any)?.message?.content || (delta as any)?.text || null;
          const reasoning = (delta as any)?.reasoning_content || (delta as any)?.reasoning || null;

          if (reasoning) {
            if (firstReasoningAt === 0) {
              firstReasoningAt = now;
              aiLog.info('ai.stream.first_reasoning', {
                flowId,
                ttfr_ms: r2(now - sendStart),
              });
            }
            chunksWithReasoning++;
            fullReasoning += reasoning;
            // Push the live reasoning to the streaming buffer so the bubble
            // can render the model's thought process as it arrives, instead
            // of waiting for stream completion to surface it.
            setStreamingReasoning(assistantMessageId, fullReasoning);
          }

          if (content) {
            if (firstContentAt === 0) {
              firstContentAt = now;
              thinkingSec = Math.round((now - sendStart) / 1000);
              aiLog.info('ai.stream.first_token', {
                flowId,
                ttft_ms: r2(now - sendStart),
                hadReasoningFirst: firstReasoningAt > 0,
              });
            }
            chunksWithContent++;
            fullContent += content;
            setStreamingText(assistantMessageId, fullContent);

            if (now - lastHapticAt >= HAPTIC_THROTTLE_MS) {
              lastHapticAt = now;
              void EnhancedHaptics.navigateHaptic();
            }
          }

          if (now - lastProgressAt >= STREAM_PROGRESS_INTERVAL_MS) {
            const windowMs = now - lastProgressAt;
            const windowChunks = chunkCount - lastProgressChunks;
            const windowChars = fullContent.length - lastProgressChars;
            aiLog.debug('ai.stream.progress', {
              flowId,
              chunks: chunkCount,
              chars: fullContent.length,
              elapsed_ms: r2(now - sendStart),
              window_ms: r2(windowMs),
              window_chunks_per_sec: r2((windowChunks / windowMs) * 1000),
              window_chars_per_sec: r2((windowChars / windowMs) * 1000),
            });
            lastProgressAt = now;
            lastProgressChunks = chunkCount;
            lastProgressChars = fullContent.length;
          }
        }

        const streamEnd = performance.now();
        const totalMs = streamEnd - sendStart;
        const streamMs = firstChunkAt > 0 ? streamEnd - firstChunkAt : 0;
        aiLog.info('ai.stream.complete', {
          flowId,
          model: modelToUse,
          chunks: chunkCount,
          chunksWithContent,
          chunksWithReasoning,
          chars: fullContent.length,
          reasoningChars: fullReasoning.length,
          ttfc_ms: firstChunkAt > 0 ? r2(firstChunkAt - sendStart) : null,
          ttft_ms: firstContentAt > 0 ? r2(firstContentAt - sendStart) : null,
          ttfr_ms: firstReasoningAt > 0 ? r2(firstReasoningAt - sendStart) : null,
          total_ms: r2(totalMs),
          stream_ms: r2(streamMs),
          max_gap_ms: r2(maxGap),
          stalls: stallCount,
          avg_inter_chunk_ms: chunkCount > 1 ? r2(streamMs / (chunkCount - 1)) : 0,
          chunks_per_sec: streamMs > 0 ? r2((chunkCount / streamMs) * 1000) : 0,
          chars_per_sec: streamMs > 0 ? r2((fullContent.length / streamMs) * 1000) : 0,
        });

        // Single atomic write: persist final content + reasoning + thinking
        // duration in place, preserving the placeholder's parentId so the
        // tree shape doesn't shift mid-finalisation.
        if (!fullContent && chunkCount > 0) {
          finalizeAssistantMessage(assistantMessageId, {
            content: '(No response received)',
            thinkingDurationSec: thinkingSec,
          });
        } else if (fullContent) {
          finalizeAssistantMessage(assistantMessageId, {
            content: fullContent,
            thinkingDurationSec: thinkingSec,
            reasoningContent: fullReasoning || undefined,
          });
        }
        aiLog.info('ai.send.assistant_finalized', {
          flowId,
          messageId: assistantMessageId,
          chars: fullContent.length,
        });

        if (!isAnonymous) updateCurrentSessionTitle();

        // Balance refresh runs detached. We use the diff (before − after) to
        // stamp `costSats` on the just-finalised message — works for both
        // the initial send and retries because each retry has its own
        // pre-call balance snapshot.
        const balanceStart = performance.now();
        // Snapshot what the affordability gate predicted for the model we
        // actually used, so the post-stream log can quote both numbers.
        const predicted = getAffordabilityDetails(modelToUse, balanceSats, cachedModels);
        const usedModelCatalogEntry = cachedModels.find((m) => m.id === modelToUse) ?? null;
        void checkBalance(apiKey)
          .then((data) => {
            setBalance(data.balance);
            const costMsats = balanceBeforeMsats - data.balance;
            const costSats = costMsats > 0 ? Math.ceil(costMsats / 1000) : undefined;
            if (costSats != null) {
              finalizeAssistantMessage(assistantMessageId, {
                content: fullContent || '(No response received)',
                thinkingDurationSec: thinkingSec,
                reasoningContent: fullReasoning || undefined,
                costSats,
              });
            }
            aiLog.info('ai.balance.refresh', {
              flowId,
              duration_ms: r2(performance.now() - balanceStart),
              balance_msats: data.balance,
              balance_sats: Math.floor(data.balance / 1000),
              costSats: costSats ?? null,
            });
            // Predicted-vs-actual reconciliation. This is the log that
            // proves the "Top up X sats" indicator is over-conservative
            // when actual cost is much lower than the buffered threshold.
            const predictedCeilingSats = predicted.bufferedThresholdSats;
            const ratio =
              predictedCeilingSats != null && costSats != null && costSats > 0
                ? r2(predictedCeilingSats / costSats)
                : null;
            aiLog.info('ai.send.actual_cost', {
              flowId,
              modelUsed: modelToUse,
              tier: tier.id,
              provider: provider.id,
              actualCostMsats: costMsats,
              actualCostSats: costSats ?? 0,
              // New realistic estimate (what `canAffordModel` now gates on).
              predicted_estimated_turn_sats: predicted.estimatedTurnCostSats,
              // Raw catalog ceiling, kept so we can keep watching the
              // estimate-vs-worst-case spread over time.
              predicted_max_cost_sats: predicted.maxCostSats,
              predicted_buffered_threshold_sats: predictedCeilingSats,
              predicted_affordable: predicted.affordable,
              predicted_deficit_sats: predicted.deficitSats,
              balance_before_msats: balanceBeforeMsats,
              balance_before_sats: Math.floor(balanceBeforeMsats / 1000),
              balance_after_msats: data.balance,
              balance_after_sats: Math.floor(data.balance / 1000),
              // ratio = how many times larger the buffered threshold is
              // than reality. We want this near 1; the previous max_cost
              // gate was producing 100× ratios for chat turns.
              predicted_to_actual_ratio: ratio,
              catalog_sats_pricing: usedModelCatalogEntry?.sats_pricing ?? null,
              catalog_context_length: usedModelCatalogEntry?.context_length ?? null,
            });
          })
          .catch((err) => {
            aiLog.warn('ai.send.balance_refresh_failed', { flowId, err });
          });

        span.end({ outcome: 'ok', chunks: chunkCount, chars: fullContent.length });
      } catch (err: any) {
        aiLog.error('ai.send.failed', {
          flowId,
          status: err?.status,
          type: err?.error?.type,
          err,
        });
        span.end({ outcome: 'error', status: err?.status });
        // Drop the placeholder on failure so the chat list doesn't show an
        // empty bubble. The active path re-derives to the previous leaf.
        removeMessages(new Set([assistantMessageId]));

        if (err?.status === 402) {
          const requiredMsats = err?.error?.details?.required as number | undefined;
          const availableMsats = err?.error?.details?.available as number | undefined;
          const requiredSats = requiredMsats != null ? Math.ceil(requiredMsats / 1000) : null;
          const availableSats = availableMsats != null ? Math.floor(availableMsats / 1000) : null;
          const friendlyName = getModelDisplayName(modelToUse, cachedModels);
          const detail =
            requiredSats != null && availableSats != null
              ? `${friendlyName} needs ${requiredSats} sats; you have ${availableSats}.`
              : `${friendlyName} costs more than your current balance.`;
          actionMenuPopup({
            title: 'Insufficient balance',
            buttons: [
              {
                text: 'Switch to Auto',
                description: detail,
                icon: AUTO_ICON,
                onPress: (close) => {
                  // Drop to the cheapest tier on the user's currently
                  // selected provider — we keep their provider choice so
                  // a Claude user doesn't unexpectedly land on OpenAI just
                  // because the request 402'd.
                  setSelectedSlot({
                    provider: provider.id,
                    tier: 'auto',
                  });
                  modelSwitchedPopup({ modelName: `${provider.label} Auto` });
                  close();
                },
              },
              {
                text: 'Top up',
                icon: 'fluent:wallet-20-filled',
                onPress: (close) => {
                  close();
                  navigateToTopUp(pendingUserMessageForTopUp);
                },
              },
            ],
          });
        } else {
          sendMessageFailedPopup({ text: err?.error?.message ?? err?.message });
        }
      } finally {
        clearStreaming();
        setStatus({ isSending: false, streamingMessageId: null });
      }
    },
    [
      apiKey,
      isAnonymous,
      removeMessages,
      finalizeAssistantMessage,
      setBalance,
      setSelectedSlot,
      updateCurrentSessionTitle,
      navigateToTopUp,
    ]
  );

  const sendInner = useCallback(
    async (userMessage: string) => {
      const trimmed = userMessage.trim();
      if (!trimmed) return;

      if (!apiKey) {
        noApiKeyPopup();
        return;
      }

      if (!isAnonymous && !currentSessionId) {
        createSession();
      }

      // Active path determines the parent of the new user message — we
      // append under whatever branch is currently visible to the user.
      const stateNow = useRoutstrStore.getState();
      const activePath = deriveActivePath(stateNow.conversationHistory, stateNow.activeChildren);
      const tail = activePath[activePath.length - 1];
      const parentForUser: string | null = tail?.id ?? null;

      const timestamp = Date.now();
      const userMessageId = `msg-${timestamp}-u`;
      const assistantMessageId = `msg-${timestamp + 1}-a`;
      const flowId = `ai-send-${timestamp}`;

      addMessage({
        id: userMessageId,
        parentId: parentForUser,
        role: 'user',
        content: trimmed,
        timestamp,
      });
      addMessage({
        id: assistantMessageId,
        parentId: userMessageId,
        role: 'assistant',
        content: '',
        timestamp: timestamp + 1,
      });

      // Build context = active path + just-added user message. We read the
      // freshly-added messages via the active path because the store has
      // already absorbed them.
      const stateAfter = useRoutstrStore.getState();
      const apiMessages = deriveActivePath(
        stateAfter.conversationHistory,
        stateAfter.activeChildren
      )
        .filter((m) => m.id !== assistantMessageId && m.content)
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));

      await streamIntoPlaceholder({
        assistantMessageId,
        apiMessages,
        flowId,
        pendingUserMessageForTopUp: trimmed,
      });
    },
    [apiKey, isAnonymous, currentSessionId, createSession, addMessage, streamIntoPlaceholder]
  );

  // `isSending` (React state) only blocks subsequent sends after the first
  // `setStatus` flush — a rapid double-tap lands both calls into
  // `streamIntoPlaceholder` before the disabled flag commits, billing the
  // user twice and corrupting the active branch tree. `useSingleFlight`
  // drops the duplicate at the ref level.
  const send = useSingleFlight(sendInner);

  /**
   * Spawn a new sibling assistant under the same parent as `messageId`,
   * stream a fresh response, and flip the active branch to the new sibling.
   * The chat list re-derives off `activeChildren` so descendants of the old
   * sibling (follow-up exchanges) drop out of view immediately and can be
   * brought back via the bubble's chevron nav.
   */
  const retryInner = useCallback(
    async (messageId: string) => {
      if (!apiKey) {
        noApiKeyPopup();
        return;
      }
      const stateNow = useRoutstrStore.getState();
      const original = stateNow.conversationHistory.find((m) => m.id === messageId);
      if (!original || original.role !== 'assistant') {
        aiLog.warn('ai.retry.invalid_target', { messageId, role: original?.role });
        return;
      }
      // Build the context that produced `messageId`: every ancestor up to
      // and including the user turn that prompted it. Excludes `messageId`
      // itself so we generate a *fresh* response.
      const ancestors = getAncestorsExclusive(messageId, stateNow.conversationHistory);
      const apiMessages = ancestors
        .filter((m) => m.content)
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));
      if (apiMessages.length === 0) {
        aiLog.warn('ai.retry.no_context', { messageId });
        return;
      }

      const timestamp = Date.now();
      const newAssistantId = `msg-${timestamp}-r`;
      const flowId = `ai-retry-${timestamp}`;
      const parentId = original.parentId ?? null;

      addMessage({
        id: newAssistantId,
        parentId,
        role: 'assistant',
        content: '',
        timestamp,
      });
      // Flip immediately so the chat list shows the streaming sibling as
      // the active branch. The user can navigate back to the original via
      // the bubble's chevron nav.
      if (parentId != null) {
        setActiveBranch(parentId, newAssistantId);
      }

      // The user message that prompted this exchange — used as the "pending
      // message" if the retry hits a 402 and we need to surface a top-up.
      const lastUserContent = ancestors.filter((m) => m.role === 'user').pop()?.content ?? '';

      await streamIntoPlaceholder({
        assistantMessageId: newAssistantId,
        apiMessages,
        flowId,
        retriedFromMessageId: messageId,
        pendingUserMessageForTopUp: lastUserContent,
      });
    },
    [apiKey, addMessage, setActiveBranch, streamIntoPlaceholder]
  );

  // Retry shares the double-tap exposure with `send`: a rapid tap on the
  // regenerate chevron would spawn two sibling assistants and bill twice.
  const retry = useSingleFlight(retryInner);

  const balance = useRoutstrStore((s) => s.balance);
  return { send, retry, ...status, balance };
}
