import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoutstrStore, type ChatAttachment } from '@/shared/stores/profile/routstrStore';
import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import {
  sendMessage,
  isModelRejectedError,
  isRoutstrNodeFailure,
  isWalletBalanceError,
  measureMessageContent,
  ROUTSTR_MAX_COMPLETION_TOKENS,
  type RoutstrChatMessage,
} from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isAbortError } from 'wallet/safeFetch';
import { pickFinalizeMessage } from '../lib/finalize';
import { actionMenuPopup, staticPopup, paramPopup } from '@/shared/lib/popup';
import { aiLog } from '@/shared/lib/logger';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import {
  AFFORD_BUFFER,
  AUTO_ICON,
  estimateTurnCostSats,
  getAffordabilityDetails,
  requiredReserveSatsFromPricing,
  getModelDisplayName,
  getProviderById,
  getTierById,
  resolveCandidateEntries,
  resolveSelectedEntry,
} from '../lib/format';
import { confirmSpend, maxSpendSats } from '../lib/spendConfirm';
import { assembleApiMessages, stripImageParts } from '../lib/assembleApiMessages';
import { encodeChatImage } from '../lib/attachments';
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

/**
 * How many models one send may try after an upstream provider declines it.
 *
 * A 402 the node forwarded from the AI provider (see `isWalletBalanceError`)
 * says nothing about the node or the user's credit, so the next candidate —
 * which usually sits behind a different upstream — is worth one attempt. The
 * cap exists because each attempt is a real paid round-trip: a node whose whole
 * upstream is down would otherwise fan out across all twelve lineup cells.
 */
const MAX_DECLINED_ATTEMPTS = 3;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Encapsulates the routstr send + stream + balance-refresh flow for the AI
 * tab. Two entry points share the same streaming core:
 *
 *   - `send(text, attachments?)` appends a new user message (with optional
 *     image attachments) under the current active leaf and streams the
 *     assistant reply.
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
 *   - Refresh the lineup on connect-time node/model failures, retrying
 *     once with the refreshed Auto entry. Never replay a started stream.
 *   - Snapshot balance before send, compute `costSats` from the post-stream
 *     exact spent-minus-change figure the send returns, and stamp it on
 *     the message.
 *   - Cashu-token-redeem flow is intentionally out of scope (still lives in
 *     `UserMessagesScreen`).
 */
export function useAiSend() {
  const [status, setStatus] = useState<SendStatus>({
    isSending: false,
    streamingMessageId: null,
  });

  const isAnonymous = useRoutstrStore((s) => s.isAnonymousMode);
  const currentSessionId = useRoutstrStore((s) => s.currentSessionId);
  const createSession = useRoutstrStore((s) => s.createSession);
  const addMessage = useRoutstrStore((s) => s.addMessage);
  const setMessagePending = useRoutstrStore((s) => s.setMessagePending);
  const removeMessages = useRoutstrStore((s) => s.removeMessages);
  const finalizeAssistantMessage = useRoutstrStore((s) => s.finalizeAssistantMessage);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);
  const setSelectedSlot = useRoutstrStore((s) => s.setSelectedSlot);
  const updateCurrentSessionTitle = useRoutstrStore((s) => s.updateCurrentSessionTitle);

  // Each `streamIntoPlaceholder` aborts the prior stream, so backgrounding
  // mid-stream stops billing. There is no longer a balance promise to wait on:
  // the cost of a request is returned by the request itself.
  const streamControllerRef = useRef<AbortController | null>(null);

  // The balance every gate and estimate prices against is the WALLET's, read
  // exactly as the header reads it. There is no separate AI balance any more,
  // so there is nothing that can disagree with it or go stale.
  const { balances: liveBalances } = useBalanceContext();
  const selectedMint = useMintStore((s) => s.selectedMint);
  const walletSats = selectedMint ? amountToNumber(liveBalances.byMint[selectedMint]?.total) : 0;

  useEffect(
    () => () => {
      streamControllerRef.current?.abort();
    },
    []
  );

  // Funding is the wallet's job now: there is no Routstr account to top up,
  // so this goes to the wallet's own receive flow rather than the send flow
  // that used to mint a deposit token for a node.
  const navigateToAddFunds = useCallback(() => {
    router.navigate({
      pathname: '/(receive-flow)/amount',
      params: {
        amountEntry: JSON.stringify({
          destination: 'mintQuote',
          unit: 'sat',
          selectedMintUrl: useMintStore.getState().selectedMint ?? '',
        }),
      },
    });
  }, []);

  /**
   * Drives a single placeholder assistant message to completion: walks the
   * candidate chain, streams tokens into `streamingBuffer`, finalises the
   * persisted message, and stamps cost asynchronously off the post-stream
   * balance diff. Both `send` and `retry` funnel through here.
   */
  const streamIntoPlaceholder = useCallback(
    async (params: {
      assistantMessageId: string;
      apiMessages: RoutstrChatMessage[];
      /** `image_url` parts included in `apiMessages` (drives the
       *  vision-aware candidate filter + request logs). */
      imageCount: number;
      flowId: string;
      retriedFromMessageId?: string;
    }) => {
      const { assistantMessageId, flowId } = params;
      let { apiMessages, imageCount } = params;

      const profile = useProfileStore.getState().activeAccountIndex;
      const storeState = useRoutstrStore.getState();
      const balanceSats = walletSats;
      const tier = getTierById(storeState.selectedTier);
      const provider = getProviderById(storeState.selectedProvider);
      const cachedModels = storeState.modelsCache?.data ?? [];
      // Resolve the (provider, tier) pair against the dynamic lineup —
      // live-derived when a catalog fetch has landed this session, else
      // the persisted last-known snapshot. `null` only on a true
      // first-run-offline (no catalog AND no snapshot): there is
      // deliberately no hardcoded id to guess at anymore, so surface it
      // instead of burning a round-trip on a dead model.
      const lineup = storeState.lineup ?? storeState.lastKnownLineup?.lineup ?? null;
      const primaryEntry = resolveSelectedEntry(provider.id, tier.id, balanceSats, lineup);
      if (!primaryEntry) {
        aiLog.warn('ai.send.no_lineup', { flowId, hasCatalog: cachedModels.length > 0 });
        removeMessages(new Set([assistantMessageId]));
        staticPopup('send-message-failed', {
          text: 'Models are still loading — check your connection and try again.',
        });
        return;
      }

      streamControllerRef.current?.abort();
      const controller = new AbortController();
      streamControllerRef.current = controller;

      // Same-tier chain across the other providers as runtime fallback for
      // connect-time failures. When the request carries image parts the
      // chain is filtered to vision-capable models — failing over an image
      // send onto a text-only model would 400 (non-retryable) and hard-fail
      // the send instead of walking the chain.
      const allEntries = resolveCandidateEntries(provider.id, tier.id, lineup);
      const primaryIdx = allEntries.findIndex((e) => e.modelId === primaryEntry.modelId);
      let candidateEntries = primaryIdx >= 0 ? allEntries.slice(primaryIdx) : [primaryEntry];
      if (imageCount > 0) {
        const visionOnly = candidateEntries.filter((e) => e.visionInput);
        if (visionOnly.length > 0) {
          candidateEntries = visionOnly;
        } else {
          // No vision-capable candidate anywhere (e.g. retry of an old
          // image turn after switching to a text-only slot). Image parts
          // sent to a text-only model 400 non-retryably, so degrade the
          // request to text-only rather than guaranteeing a hard fail.
          aiLog.warn('ai.attach.no_vision_candidate', { flowId, droppedImages: imageCount });
          apiMessages = stripImageParts(apiMessages);
          imageCount = 0;
        }
      }
      const primaryModel = primaryEntry.modelId;
      let candidateChain = candidateEntries.map((e) => e.modelId);

      setStatus({ isSending: true, streamingMessageId: assistantMessageId });
      // Captures `Date.now()` for the live "Thinking for X seconds"
      // counter rendered by the bubble. Resets text + reasoning channels
      // so a previous stream's tail can't leak into this one.
      startStreaming(assistantMessageId);

      // Hoisted so the catch block (402 popup) can reference whichever
      // candidate we were last attempting when the request failed.
      let modelToUse = primaryModel;

      // AI completions routinely run multiple seconds; keep the span's
      // slow-escalation thresholds well above the default 1s/5s so a normal
      // success doesn't log as ERROR (audit 34 F-005).
      const span = aiLog.startSpan(
        'ai.send',
        {
          flowId,
          tier: tier.id,
          provider: provider.id,
          model: primaryModel,
          candidateCount: candidateChain.length,
          balanceSats,
          retried: params.retriedFromMessageId ?? null,
        },
        { warnAtMs: 15_000, errorAtMs: 60_000 }
      );

      try {
        // Text chars + image-part count — never serialises base64 payloads
        // into a log line.
        const { textChars: apiInputChars, imageParts } = measureMessageContent(apiMessages);
        const sendStart = performance.now();
        aiLog.info('ai.send.request', {
          flowId,
          tier: tier.id,
          provider: provider.id,
          primaryModel,
          candidates: candidateChain,
          historyMessages: apiMessages.length,
          totalInputChars: apiInputChars,
          imageParts,
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
          balanceSats,
          selectedTier: tier.id,
          selectedProvider: provider.id,
          buffer: AFFORD_BUFFER,
          catalogSize: cachedModels.length,
          candidates: candidateSnapshots,
          // Per-image fees (e.g. Gemini) make an attachment turn cost more
          // than the text-only estimate in the per-candidate snapshots.
          imageParts,
          estimatedTurnCostWithImagesSats:
            imageParts > 0 ? estimateTurnCostSats(primaryModel, cachedModels, imageParts) : null,
        });

        let stream: AsyncIterable<any> | undefined;
        let costSats: number | undefined;
        let lastConnectErr: unknown = null;
        let recoveryRetried = false;
        let declinedAttempts = 0;
        for (let i = 0; i < candidateChain.length; i++) {
          if (useProfileStore.getState().activeAccountIndex !== profile) return;
          if (controller.signal.aborted) throw { status: 0, error: { type: 'aborted' } };
          const candidate = candidateChain[i];
          modelToUse = candidate;
          const requestNode = useRoutstrStore.getState().nodeBaseUrl;
          // Always send max_tokens: Routstr only discounts the completion
          // side of its upfront balance reservation when the request bounds
          // it — omitting max_tokens makes the node demand the model's FULL
          // max_completion_cost (~1,500 sats on frontier models) and 402
          // balances that cover the real turn cost many times over. Clamped
          // under the model's own completion ceiling when the lineup knows it.
          const candidateCeiling = candidateEntries[i]?.maxCompletionTokens;
          const maxTokens =
            candidateCeiling != null && candidateCeiling > 0
              ? Math.min(ROUTSTR_MAX_COMPLETION_TOKENS, candidateCeiling)
              : ROUTSTR_MAX_COMPLETION_TOKENS;
          // The token attached to the request has to clear the node's
          // admission gate, which is the same figure the affordability chip
          // shows — not the expected cost. Anything unspent comes straight
          // back as change, so over-funding costs nothing but a swap.
          const gateSats = Math.max(
            1,
            Math.ceil(
              (requiredReserveSatsFromPricing(
                candidateEntries[i]?.satsPricing ?? null,
                imageCount
              ) ?? 1) * AFFORD_BUFFER
            )
          );
          try {
            const result = await sendMessage(apiMessages, {
              model: candidate,
              paymentSats: gateSats,
              // Both money legs point back at the exchange they bought, so a
              // cost in history can be traced to the answer it produced.
              payment: {
                groupId: flowId,
                sessionId: useRoutstrStore.getState().currentSessionId ?? undefined,
                messageId: assistantMessageId,
                model: candidate,
              },
              temperature: 0.7,
              max_tokens: maxTokens,
              signal: controller.signal,
            });
            stream = result.stream;
            costSats = result.costSats;
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
            if (isAbortError(err) || controller.signal.aborted) throw err;
            const status = (err as { status?: number })?.status;
            // An upstream decline: the node is healthy, the catalog is current
            // and the user's credit is fine — the AI provider behind THIS model
            // refused. Another candidate usually sits behind a different
            // upstream, so advance without refreshing the lineup (there is
            // nothing stale to refresh) and without touching the balance.
            if (status === 402 && !isWalletBalanceError(err)) {
              declinedAttempts += 1;
              // Skip every remaining candidate behind the upstream that just
              // refused. A node fronts several upstream accounts and they fail
              // independently — when one runs out of credit, every model
              // behind it answers 402 identically, so trying a sibling is
              // paying to be refused again. Observed: three candidates, three
              // 402s, all `openrouter`. Only narrows when the node reports
              // upstreams; otherwise the walk is exactly as before.
              const declinedUpstream = candidateEntries[i]?.upstreamId ?? null;
              let next = i + 1;
              if (declinedUpstream) {
                while (
                  next < candidateChain.length &&
                  candidateEntries[next]?.upstreamId === declinedUpstream
                ) {
                  next++;
                }
              }
              if (declinedAttempts >= MAX_DECLINED_ATTEMPTS || next >= candidateChain.length) {
                // Every candidate we were willing to try refused. A 402 is not
                // an `isRoutstrNodeFailure`, so nothing else on this path ever
                // re-asks nagg — and a node whose upstream credit has run out
                // serves a perfect catalog forever, so the foreground refresh's
                // 24-hour freshness rule keeps the app pinned to it. Ask once
                // (throttled to 5 minutes) so the NEXT send can land on a node
                // nagg has since repointed to. Not retried here: a repoint also
                // invalidates the key, so this send is over either way.
                void refreshRoutstrLineup('failure');
                throw err;
              }
              aiLog.warn('ai.send.provider_declined', {
                flowId,
                tier: tier.id,
                provider: provider.id,
                candidate,
                declinedUpstream,
                skippedSameUpstream: next - i - 1,
                attempt: declinedAttempts,
                nextCandidate: candidateChain[next],
              });
              i = next - 1; // the loop's i++ lands on `next`
              continue;
            }
            const modelRejected = isModelRejectedError(err, candidate);
            const nodeFailed = isRoutstrNodeFailure(err);
            if (!modelRejected && !nodeFailed) throw err;
            const refreshed = await refreshRoutstrLineup('failure');
            if (useProfileStore.getState().activeAccountIndex !== profile) return;
            if (controller.signal.aborted) throw { status: 0, error: { type: 'aborted' } };
            const current = useRoutstrStore.getState();
            const nodeChanged = current.nodeBaseUrl !== requestNode;
            if (!recoveryRetried && (nodeChanged || (modelRejected && refreshed))) {
              const entry = resolveSelectedEntry(
                provider.id,
                'auto',
                Math.floor((current.balance ?? 0) / 1000),
                current.lineup
              );
              if (entry && (imageCount === 0 || entry.visionInput)) {
                recoveryRetried = true;
                candidateEntries = [entry];
                candidateChain = [entry.modelId];
                i = -1;
                aiLog.info('ai.send.lineup_retry', { flowId, nodeChanged });
                continue;
              }
            }
            // Repeating a node-level failure across models cannot repair the node.
            if (nodeFailed || recoveryRetried || i === candidateChain.length - 1) throw err;
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
        const finalizePayload = pickFinalizeMessage({
          fullContent,
          fullReasoning,
          chunkCount,
        });
        if (finalizePayload) {
          finalizeAssistantMessage(assistantMessageId, {
            ...finalizePayload,
            thinkingDurationSec: thinkingSec,
          });
        }
        aiLog.info('ai.send.assistant_finalized', {
          flowId,
          messageId: assistantMessageId,
          chars: fullContent.length,
        });

        if (!isAnonymous) updateCurrentSessionTitle();

        // The cost is exact and already known: `sendMessage` returns what the
        // node actually took (the token we minted minus the change it handed
        // back). It replaces a `checkBalance` diff that only worked while a
        // balance lived on the node, that a concurrent write could corrupt,
        // and that a node change made meaningless.
        if (finalizePayload && costSats != null) {
          finalizeAssistantMessage(assistantMessageId, {
            ...finalizePayload,
            thinkingDurationSec: thinkingSec,
            costSats,
          });
        }
        // Snapshot what the affordability gate predicted for the model we
        // actually used, so this log can quote both numbers.
        const predicted = getAffordabilityDetails(modelToUse, balanceSats, cachedModels);
        const usedModelCatalogEntry = cachedModels.find((m) => m.id === modelToUse) ?? null;
        const predictedCeilingSats = predicted.bufferedThresholdSats;
        aiLog.info('ai.send.actual_cost', {
          flowId,
          modelUsed: modelToUse,
          tier: tier.id,
          provider: provider.id,
          actualCostSats: costSats ?? 0,
          predicted_estimated_turn_sats: predicted.estimatedTurnCostSats,
          predicted_max_cost_sats: predicted.maxCostSats,
          predicted_buffered_threshold_sats: predictedCeilingSats,
          // ratio = how many times larger the gate is than reality. Now that
          // the gate is what we actually LOCK for the request, a large ratio
          // is money held needlessly, not just a pessimistic label.
          predicted_to_actual_ratio:
            predictedCeilingSats != null && costSats != null && costSats > 0
              ? r2(predictedCeilingSats / costSats)
              : null,
          catalog_sats_pricing: usedModelCatalogEntry?.sats_pricing ?? null,
          catalog_context_length: usedModelCatalogEntry?.context_length ?? null,
        });

        span.end({ outcome: 'ok', chunks: chunkCount, chars: fullContent.length });
      } catch (err: any) {
        if (useProfileStore.getState().activeAccountIndex !== profile) return;
        if (isAbortError(err) || controller.signal.aborted) {
          aiLog.info('ai.send.aborted', { flowId });
          removeMessages(new Set([assistantMessageId]));
          span.end({ outcome: 'aborted' });
          return;
        }
        aiLog.error('ai.send.failed', {
          flowId,
          status: err?.status,
          type: err?.error?.type,
        });
        span.end({ outcome: 'error', status: err?.status });
        // Drop the placeholder on failure so the chat list doesn't show an
        // empty bubble. The active path re-derives to the previous leaf.
        removeMessages(new Set([assistantMessageId]));

        // A 402 is only OUR problem when routstr raised it about this key's
        // balance. The node forwards an upstream provider's error body verbatim
        // under the provider's status, so an upstream 402 is indistinguishable
        // by status alone — and sending the user to top up a wallet that is
        // already funded cannot clear it. Everything else goes through the
        // shared error catalog.
        if (isWalletBalanceError(err)) {
          const requiredMsats = err?.error?.details?.required as number | undefined;
          const availableMsats = err?.error?.details?.available as number | undefined;
          const requiredSats = requiredMsats != null ? Math.ceil(requiredMsats / 1000) : null;
          const availableSats = availableMsats != null ? Math.floor(availableMsats / 1000) : null;
          const friendlyName = getModelDisplayName(modelToUse, cachedModels);
          // Exact shortfall straight from the server's 402 details (msats):
          // the one number guaranteed to unlock this model, vs. re-deriving
          // it from pricing that may have drifted since the catalog fetch.
          const shortfallSats =
            requiredMsats != null && availableMsats != null
              ? Math.max(1, Math.ceil((requiredMsats - availableMsats) / 1000))
              : null;
          const detail =
            requiredSats != null && availableSats != null
              ? `${friendlyName} reserves ${requiredSats} sats per request; ${availableSats} available. Add at least ${shortfallSats} sats.`
              : `${friendlyName} reserves more per request than your wallet holds.`;
          actionMenuPopup({
            title: 'Insufficient balance',
            buttons: [
              {
                testID: 'ai-insufficient-balance-auto',
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
                  paramPopup('model-switched', { modelName: `${provider.label} Auto` });
                  close();
                },
              },
              {
                testID: 'ai-insufficient-balance-topup',
                text: 'Add funds',
                icon: 'fluent:wallet-20-filled',
                onPress: (close) => {
                  close();
                  navigateToAddFunds();
                },
              },
            ],
          });
        } else {
          staticPopup('send-message-failed', { failure: { service: 'routstr', error: err } });
        }
      } finally {
        clearStreaming();
        setStatus({ isSending: false, streamingMessageId: null });
      }
    },
    [
      isAnonymous,
      removeMessages,
      finalizeAssistantMessage,
      setSelectedSlot,
      updateCurrentSessionTitle,
      navigateToAddFunds,
    ]
  );

  const sendInner = useCallback(
    async (userMessage: string, attachments?: ChatAttachment[]) => {
      const trimmed = userMessage.trim();
      if (!trimmed) return;

      // Ask BEFORE the optimistic bubbles go in: declining after them would
      // leave a user message with no answer and nothing to retry.
      const storeNow = useRoutstrStore.getState();
      const plannedEntry = resolveSelectedEntry(
        getProviderById(storeNow.selectedProvider).id,
        getTierById(storeNow.selectedTier).id,
        walletSats,
        storeNow.lineup ?? storeNow.lastKnownLineup?.lineup ?? null
      );
      const allowed = await confirmSpend({
        modelName: plannedEntry?.displayName ?? getTierById(storeNow.selectedTier).label,
        maxSats: maxSpendSats(plannedEntry, attachments?.length ?? 0),
      });
      if (!allowed) return;

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
        pending: true,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
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
      // already absorbed them. Assembly (incl. the inline-image window and
      // per-attachment encoding) is shared with retry via
      // `assembleApiMessages` so the two flows can't diverge.
      const stateAfter = useRoutstrStore.getState();
      const path = deriveActivePath(
        stateAfter.conversationHistory,
        stateAfter.activeChildren
      ).filter((m) => m.id !== assistantMessageId);
      const { messages: apiMessages, imageCount } = await assembleApiMessages(
        path,
        encodeChatImage
      );

      try {
        await streamIntoPlaceholder({
          assistantMessageId,
          apiMessages,
          imageCount,
          flowId,
        });
      } finally {
        // The user message's optimistic spinner clears the moment the
        // streaming round-trip resolves — success or error, the request
        // left our hands. Errors surface via the assistant placeholder /
        // popup, not the user bubble's check.
        setMessagePending(userMessageId, false);
      }
    },
    [
      isAnonymous,
      currentSessionId,
      createSession,
      addMessage,
      setMessagePending,
      streamIntoPlaceholder,
    ]
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
      const stateNow = useRoutstrStore.getState();
      const original = stateNow.conversationHistory.find((m) => m.id === messageId);
      if (!original || original.role !== 'assistant') {
        aiLog.warn('ai.retry.invalid_target', { messageId, role: original?.role });
        return;
      }
      // Build the context that produced `messageId`: every ancestor up to
      // and including the user turn that prompted it. Excludes `messageId`
      // itself so we generate a *fresh* response. Same assembly as `send`
      // (inline-image window included) so a retry of an image turn re-sends
      // the same content parts the original did.
      const ancestors = getAncestorsExclusive(messageId, stateNow.conversationHistory);
      const { messages: apiMessages, imageCount } = await assembleApiMessages(
        ancestors,
        encodeChatImage
      );
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

      await streamIntoPlaceholder({
        assistantMessageId: newAssistantId,
        apiMessages,
        imageCount,
        flowId,
        retriedFromMessageId: messageId,
      });
    },
    [addMessage, setActiveBranch, streamIntoPlaceholder]
  );

  // Retry shares the double-tap exposure with `send`: a rapid tap on the
  // regenerate chevron would spawn two sibling assistants and bill twice.
  const retry = useSingleFlight(retryInner);

  const balance = useRoutstrStore((s) => s.balance);
  return { send, retry, ...status, balance };
}
