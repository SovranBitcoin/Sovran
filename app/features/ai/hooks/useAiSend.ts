import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoutstrStore, type ChatAttachment } from '@/shared/stores/profile/routstrStore';
import { useRoutstrFunds } from './useRoutstrFunds';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import {
  sendMessage,
  isModelRejectedError,
  isRoutstrNodeFailure,
  isWalletBalanceError,
  measureMessageContent,
  type RoutstrChatMessage,
} from '@/shared/lib/routstr/api';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { lineupHasEntries, lineupProviderIds, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isAbortError } from 'wallet/safeFetch';
import { pickFinalizeMessage } from '../lib/finalize';
import { staticPopup } from '@/shared/lib/popup';
import { describeError } from '@/shared/lib/errors';
import { ERROR_COPY } from '@/shared/lib/errors/catalog';
import { aiLog } from '@/shared/lib/logger';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import {
  AFFORD_BUFFER,
  estimateTurnCostSats,
  getAffordabilityDetails,
  getModelDisplayName,
  getProviderById,
  getTierById,
  resolveCandidateEntries,
  resolveSelectedEntry,
  selectFromChain,
  sendMaxTokens,
} from '../lib/format';
import { confirmSpend } from '../lib/spendConfirm';
import { evaluateSendGate } from '../lib/sendGate';
import { useHeldMints } from './useHeldMints';
import { assembleApiMessages, stripImageParts } from '../lib/assembleApiMessages';
import { encodeChatImage } from '../lib/attachments';
import { deriveActivePath, getAncestorsExclusive } from '../lib/branching';
import { navigateToAddFunds } from '../lib/navigateToAddFunds';
import { clearTurnError, recordTurnError } from '../lib/turnErrors';
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
  const updateCurrentSessionTitle = useRoutstrStore((s) => s.updateCurrentSessionTitle);

  // Each `streamIntoPlaceholder` aborts the prior stream, so backgrounding
  // mid-stream stops billing. There is no longer a balance promise to wait on:
  // the cost of a request is returned by the request itself.
  const streamControllerRef = useRef<AbortController | null>(null);

  const funds = useRoutstrFunds();
  const latestFunds = useLatestRef(funds);
  const walletSats = funds?.balanceSats ?? 0;
  const heldMints = useHeldMints();

  useEffect(
    () => () => {
      streamControllerRef.current?.abort();
    },
    []
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
      // ONE chain, built once and never widened. Its `sealed` tag carries the
      // user's encryption choice through every later narrowing below — the
      // vision filter and the post-repoint recovery both derive from it, and
      // neither can reach a vendor the chain did not already contain.
      const chain = resolveCandidateEntries(provider.id, tier.id, lineup);
      const primaryEntry = selectFromChain(chain, balanceSats);
      if (!primaryEntry) {
        // Two different absences wearing one shape. An empty plaintext chain
        // means the catalogue never landed. An empty SEALED chain means it
        // did, and this node serves nothing encrypted — the models we could
        // reach are all plaintext, and the user asked for the opposite. Saying
        // "the model list has not loaded" there would send them to retry a
        // connection that is fine.
        // Three absences wearing one shape, not two. A sealed chain that is
        // empty against a real lineup means the node serves nothing encrypted.
        // A PLAINTEXT chain empty against a real lineup means the catalogue
        // landed and nothing in it is usable here — "the model list has not
        // loaded" is false for both, and sends the user to retry a connection
        // that is fine. Only a genuinely absent lineup is a loading problem.
        const haveLineup = lineupHasEntries(lineup);
        const id = chain.sealed
          ? haveLineup
            ? 'routstr.e2ee_unavailable'
            : 'routstr.catalog_unavailable'
          : haveLineup
            ? 'routstr.no_usable_models'
            : 'routstr.catalog_unavailable';
        // `hasCatalog` alone read as a contradiction in the logs — a refusal
        // to send while holding 582 catalogue rows. It was never lying: the
        // catalogue is not the lineup, and the lineup is not the lineup THIS
        // selection can reach. Say all three, so the next occurrence names its
        // own cause instead of needing the surrounding events to explain it.
        aiLog.warn('ai.send.no_lineup', {
          flowId,
          hasCatalog: cachedModels.length > 0,
          catalogSize: cachedModels.length,
          hasLineup: lineupHasEntries(lineup),
          lineupProviders: lineupProviderIds(lineup),
          selectedProvider: provider.id,
          selectedTier: tier.id,
          sealedSelection: chain.sealed,
          errorId: id,
        });
        // Same contract as a failed request: the turn stays in the
        // conversation and says, in place, why it could not run.
        recordTurnError(assistantMessageId, { id, text: ERROR_COPY[id] });
        return;
      }

      streamControllerRef.current?.abort();
      const controller = new AbortController();
      streamControllerRef.current = controller;

      // Same-tier chain across the other providers as runtime fallback for
      // connect-time failures — or, on a sealed selection, the encrypted
      // vendor's own ladder and nothing else (see `resolveCandidateEntries`).
      // When the request carries image parts the chain is filtered to
      // vision-capable models — failing over an image send onto a text-only
      // model would 400 (non-retryable) and hard-fail the send instead of
      // walking the chain.
      const allEntries = chain.entries;
      const primaryIdx = allEntries.findIndex((e) => e.modelId === primaryEntry.modelId);
      let candidateEntries: readonly LineupEntry[] =
        primaryIdx >= 0 ? allEntries.slice(primaryIdx) : [primaryEntry];
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
      // A placeholder that is streaming is not a failed one. Ids are fresh per
      // send and per retry, so this only ever matters if one is re-driven.
      clearTurnError(assistantMessageId);

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
        // Resolved after the stream ends: the exact figure is the token we
        // spent minus the change the node returned, and the change is only
        // banked once the response is complete.
        let costPromise: Promise<number> | undefined;
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
          // `sendMaxTokens` is the one spelling of that clamp; the
          // affordability gate prices the same call, so the reservation the
          // user was shown is the one the node charges.
          const maxTokens = sendMaxTokens(candidateEntries[i]?.maxCompletionTokens);
          try {
            // The token attached to the request has to clear the node's
            // admission gate — not the expected cost — and `@routstr/sdk`
            // sizes it the same way the node does, from the catalog pricing
            // the lineup already seeded. Anything unspent comes straight back
            // as change, so over-funding costs nothing but a swap.
            const result = await sendMessage(apiMessages, {
              model: candidate,
              // Both money legs point back at the exchange they bought, so a
              // cost in history can be traced to the answer it produced.
              payment: {
                groupId: flowId,
                sessionId: useRoutstrStore.getState().currentSessionId ?? undefined,
                messageId: assistantMessageId,
                model: candidate,
              },
              // No `temperature`. The reference clients send none
              // (routstr-chat `useChatActions`, `@routstr/sdk`
              // `fetchAIResponse`), and — unlike `max_tokens`, which the
              // catalogue justifies per model through
              // `top_provider.max_completion_tokens` — `RoutstrModel` carries
              // no field saying which models accept a sampling temperature.
              // Reasoning models reject a non-default one outright, so a
              // blanket 0.7 is a guess that can only lose.
              max_tokens: maxTokens,
              signal: controller.signal,
            });
            stream = result.stream;
            costPromise = result.cost;
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
              // Rebuilt through the same constructor rather than reaching into
              // the refreshed lineup directly: a repoint is exactly where a
              // sealed selection would otherwise be handed the new node's
              // cheapest plaintext Auto model and never told.
              const entry = selectFromChain(
                resolveCandidateEntries(provider.id, 'auto', current.lineup),
                Math.floor((current.balance ?? 0) / 1000)
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
        // The change is home by now, so the figure is final. A failure here
        // is a missing cost label, never a lost message: the send already
        // happened and the sweep chases anything the node still holds.
        costSats = await costPromise?.catch(() => undefined);

        if (finalizePayload) {
          // One atomic write, cost included. The cost is exact and already
          // known — `sendMessage` returns what the node took (the token we
          // minted minus the change it returned), and the change header
          // arrives before the first chunk — so there is nothing to stamp on
          // afterwards. That second write was only ever needed because the old
          // figure came from a balance re-read that had to wait for the stream.
          finalizeAssistantMessage(assistantMessageId, {
            ...finalizePayload,
            thinkingDurationSec: thinkingSec,
            ...(costSats != null && costSats > 0 ? { costSats } : {}),
          });
        }
        aiLog.info('ai.send.assistant_finalized', {
          flowId,
          messageId: assistantMessageId,
          chars: fullContent.length,
        });

        if (!isAnonymous) updateCurrentSessionTitle();

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

        // The placeholder STAYS. A failed turn used to be deleted and
        // announced by a toast somewhere else on screen, which left the user
        // looking at their own question with nothing to press and no record
        // of what happened. Its bubble now renders an error pill in place of
        // the answer, carrying the actions this particular failure admits —
        // see `chatErrorActions`.
        const presentation = describeError(err, 'routstr');

        // A 402 is only OUR problem when routstr raised it about this key's
        // balance. The node forwards an upstream provider's error body verbatim
        // under the provider's status, so an upstream 402 is indistinguishable
        // by status alone — and sending the user to top up a wallet that is
        // already funded cannot clear it. `describeError` makes that same
        // distinction (`routstr.balance` vs `routstr.provider_declined`); what
        // the markers add here is the exact shortfall, which no catalogue copy
        // can carry.
        let detail: string | undefined;
        if (isWalletBalanceError(err)) {
          const requiredMsats = err?.error?.details?.required as number | undefined;
          const availableMsats = err?.error?.details?.available as number | undefined;
          const requiredSats = requiredMsats != null ? Math.ceil(requiredMsats / 1000) : null;
          const availableSats = availableMsats != null ? Math.floor(availableMsats / 1000) : null;
          const friendlyName = getModelDisplayName(modelToUse, cachedModels);
          // Exact shortfall straight from the server's 402 details (msats):
          // the one number guaranteed to unlock this model, vs. re-deriving
          // it from pricing that may have drifted since the catalog fetch.
          // Our own arithmetic over structured fields — never their prose.
          const shortfallSats =
            requiredMsats != null && availableMsats != null
              ? Math.max(1, Math.ceil((requiredMsats - availableMsats) / 1000))
              : null;
          detail =
            requiredSats != null && availableSats != null
              ? `${friendlyName} reserves ${requiredSats} sats per request; ${availableSats} available. Add at least ${shortfallSats} sats.`
              : `${friendlyName} reserves more per request than your wallet holds.`;
        }
        recordTurnError(assistantMessageId, {
          id: presentation.id,
          text: presentation.text,
          ...(detail != null ? { detail } : {}),
        });
        aiLog.info('ai.turn_error.shown', {
          flowId,
          messageId: assistantMessageId,
          errorId: presentation.id,
        });
      } finally {
        clearStreaming();
        setStatus({ isSending: false, streamingMessageId: null });
      }
    },
    [isAnonymous, removeMessages, finalizeAssistantMessage, updateCurrentSessionTitle, walletSats]
  );

  const sendInner = useCallback(
    async (userMessage: string, attachments?: ChatAttachment[]) => {
      // Every precondition in one place, decided before the optimistic bubbles
      // go in: declining after them would leave a user message with no answer
      // and nothing to retry. The gate is pure and exhaustive, so each way a
      // send can fail to start has a name and its own thing to say — a missing
      // provider, a mint the provider refuses and a declined confirmation used
      // to be indistinguishable from outside.
      const trimmed = userMessage.trim();
      const storeNow = useRoutstrStore.getState();
      const owner = useProfileStore.getState().activeAccountIndex;
      const quotedFunds = latestFunds.current;
      const activeProvider = storeNow.userNodeBaseUrl;
      const plannedEntry = resolveSelectedEntry(
        getProviderById(storeNow.selectedProvider).id,
        getTierById(storeNow.selectedTier).id,
        walletSats,
        storeNow.lineup ?? storeNow.lastKnownLineup?.lineup ?? null
      );
      const gate = evaluateSendGate({
        text: trimmed,
        providerBaseUrl: activeProvider,
        providerMints: activeProvider ? (storeNow.knownProviders[activeProvider]?.mints ?? []) : [],
        heldMints,
        walletSats,
        entry: plannedEntry,
        imageCount: attachments?.length ?? 0,
        confirmSpend: storeNow.confirmSpend,
      });

      aiLog.info('ai.send.gate', { state: gate.state });
      switch (gate.state) {
        case 'empty':
          return;
        case 'no-provider':
          // The one refusal with somewhere to go: the list is the answer.
          staticPopup('ai-no-provider');
          router.navigate('/(ai-flow)/providers');
          return;
        case 'mint-not-accepted':
          staticPopup('ai-mint-not-accepted');
          return;
        case 'insufficient-funds':
          navigateToAddFunds();
          return;
        case 'confirm': {
          const allowed = await confirmSpend({
            modelName: gate.modelName,
            maxSats: gate.maxSats,
          });
          if (!allowed) return;
          const current = useRoutstrStore.getState();
          const currentFunds = latestFunds.current;
          if (
            useProfileStore.getState().activeAccountIndex !== owner ||
            current.userNodeBaseUrl !== activeProvider ||
            current.selectedProvider !== storeNow.selectedProvider ||
            current.selectedTier !== storeNow.selectedTier ||
            current.lineup !== storeNow.lineup ||
            currentFunds?.mintUrl !== quotedFunds?.mintUrl ||
            currentFunds?.balanceSats !== quotedFunds?.balanceSats
          ) {
            staticPopup('ai-payment-options-changed');
            return;
          }
          break;
        }
        case 'ready':
          break;
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
        // left our hands. Errors surface as a pill on the assistant
        // placeholder, not on the user bubble's check.
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
      walletSats,
      heldMints,
      latestFunds,
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
