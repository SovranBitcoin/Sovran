import { useCallback, useEffect, useRef } from 'react';
import {
  selectConversationId,
  selectLineup,
  useRoutstrStore,
  type ChatAttachment,
} from '@/shared/stores/profile/routstrStore';
import { useRoutstrFunds } from './useRoutstrFunds';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import {
  sendMessage,
  isModelRejectedError,
  isPaymentLayerFailure,
  isRoutstrNodeFailure,
  isUpstreamRefusal,
  isWalletBalanceError,
  measureMessageContent,
  type RoutstrChatMessage,
} from '@/shared/lib/routstr/api';
import { markModelUnavailable, orderByAvailability } from '../lib/modelAvailability';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { lineupHasEntries, lineupProviderIds, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isAbortError } from 'wallet/safeFetch';
import { isBudgetTruncation, pickFinalizeMessage } from '../lib/finalize';
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
  slotForModel,
  sendMaxTokens,
} from '../lib/format';
import { confirmSpend } from '../lib/spendConfirm';
import { evaluateSendGate } from '../lib/sendGate';
import { reservedSatsForSend } from '../lib/reserve';
import { useHeldMints } from './useHeldMints';
import { assembleApiMessages, stripImageParts } from '../lib/assembleApiMessages';
import { encodeChatImage } from '../lib/attachments';
import { deriveActivePath, getAncestorsExclusive } from '../lib/branching';
import { useNavigateToAddFunds } from '../lib/navigateToAddFunds';
import { dispatchTurn, useAnyTurnLive } from '../lib/turns';

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
/**
 * What the send gate is given as the typed text for a regenerate. Nothing is
 * typed for one; the gate only asks whether there is something to send.
 */
const REASKED_QUESTION = 'regenerate';

/**
 * The candidate chain for a selection, with models this node refused recently
 * moved behind the rest.
 *
 * Used by BOTH the quote and the send, so the sheet names the model that will
 * actually be tried first. The catalog said the node serves them; its upstream
 * said otherwise a moment ago, and paying to hear it a third time is what the
 * 2026-09-26 log shows. Demoted, never dropped — still tried if nothing else
 * works — and the memory expires with the node's outage.
 */
function availableChain(
  provider: string,
  tier: Parameters<typeof resolveCandidateEntries>[1],
  lineup: Parameters<typeof resolveCandidateEntries>[2],
  nodeBaseUrl: string | null
): ReturnType<typeof resolveCandidateEntries> {
  const chain = resolveCandidateEntries(provider, tier, lineup);
  // Branched so each side keeps its own entry type: the sealed brand is what
  // stops a plaintext entry being pushed into a sealed chain by a widening.
  const ordered = chain.sealed
    ? { sealed: true as const, entries: orderByAvailability(nodeBaseUrl, chain.entries) }
    : { sealed: false as const, entries: orderByAvailability(nodeBaseUrl, chain.entries) };
  if (ordered.entries[0] !== chain.entries[0]) {
    aiLog.info('ai.send.primary_demoted', {
      nodeBaseUrl,
      demoted: chain.entries[0]?.modelId,
      promoted: ordered.entries[0]?.modelId,
    });
  }
  return ordered;
}

/** The selected (provider, tier), the lineup it resolves against and the chain a send walks. */
function selectedChain(state: ReturnType<typeof useRoutstrStore.getState>) {
  const provider = getProviderById(state.selectedProvider);
  const tier = getTierById(state.selectedTier);
  const lineup = selectLineup(state);
  const chain = availableChain(provider.id, tier.id, lineup, state.nodeBaseUrl);
  return { provider, tier, lineup, chain };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run a send or regenerate with its request's controller, held in `preparing`
 * (what closing the screen aborts) until the stream takes it or the run ends,
 * and with a watch on the account and conversation it was started in.
 */
async function withRequestController(
  preparing: Set<AbortController>,
  run: (controller: AbortController, watch: OwnerWatch) => Promise<void>
): Promise<void> {
  const controller = new AbortController();
  preparing.add(controller);
  const watch = watchOwner(currentOwner());
  try {
    await run(controller, watch);
  } finally {
    watch.stop();
    preparing.delete(controller);
  }
}

/** The account and conversation a send or regenerate belongs to, taken before its first wait. */
type Owner = { account: number; anonymous: boolean; conversationId: string | null };

function currentOwner(): Owner {
  const state = useRoutstrStore.getState();
  return {
    account: useProfileStore.getState().activeAccountIndex,
    anonymous: state.isAnonymousMode,
    conversationId: selectConversationId(state),
  };
}

type OwnerChange = 'none' | 'account' | 'conversation';

/** What moved since `owner` was taken: a request then would be sent for the wrong one. */
function ownerChange(owner: Owner): OwnerChange {
  const now = currentOwner();
  if (now.account !== owner.account) return 'account';
  if (now.anonymous !== owner.anonymous || now.conversationId !== owner.conversationId)
    return 'conversation';
  return 'none';
}

/** An owner watched from when it was taken until `stop`. */
type OwnerWatch = { owner: Owner; change: () => OwnerChange; stop: () => void };

/**
 * Watch `owner` for every change to the account or conversation, not only at
 * the moments it is asked. A move is kept once seen, even when it is undone:
 * a request whose conversation was left and opened again, or whose account was
 * switched and back, is over for good. `change` says `account` while another
 * account is active (its store holds that account's conversations), and
 * `conversation` for any other move seen since `owner` was taken.
 */
function watchOwner(owner: Owner): OwnerWatch {
  let moved = false;
  const change = (): OwnerChange => {
    const now = ownerChange(owner);
    if (now !== 'none') moved = true;
    if (now === 'account') return 'account';
    return moved ? 'conversation' : 'none';
  };
  const offs = [useRoutstrStore.subscribe(change), useProfileStore.subscribe(change)];
  return { owner, change, stop: () => offs.forEach((off) => off()) };
}

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
 *   - Move the answer's turn (`turns`) through asking, streaming and how it
 *     settled, by its message id, so a stream only ever touches its own
 *     answer. Tokens stream there instead of into `routstrStore`, so
 *     per-token AsyncStorage writes are avoided (those caused the "sudden
 *     reveal" lag).
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
  const isSending = useAnyTurnLive();

  const isAnonymous = useRoutstrStore((s) => s.isAnonymousMode);
  const currentSessionId = useRoutstrStore((s) => s.currentSessionId);
  const createSession = useRoutstrStore((s) => s.createSession);
  const addMessages = useRoutstrStore((s) => s.addMessages);
  const setMessagePending = useRoutstrStore((s) => s.setMessagePending);
  const finalizeAssistantMessage = useRoutstrStore((s) => s.finalizeAssistantMessage);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);
  const updateSessionTitle = useRoutstrStore((s) => s.updateSessionTitle);

  // Each `streamIntoPlaceholder` aborts the prior stream, so backgrounding
  // mid-stream stops billing. There is no longer a balance promise to wait on:
  // the cost of a request is returned by the request itself.
  const streamControllerRef = useRef<AbortController | null>(null);
  // Each send or regenerate still getting ready (encoding images, the spend
  // sheet): its request's controller, so closing the screen stops it too.
  const preparingRef = useRef(new Set<AbortController>());

  const navigateToAddFunds = useNavigateToAddFunds();
  const funds = useRoutstrFunds();
  const latestFunds = useLatestRef(funds);
  const walletSats = funds?.balanceSats ?? 0;
  const heldMints = useHeldMints();

  useEffect(() => {
    const preparing = preparingRef.current;
    return () => {
      streamControllerRef.current?.abort();
      for (const controller of preparing) controller.abort();
    };
  }, []);

  /**
   * Drives a single placeholder assistant message to completion: walks the
   * candidate chain, streams tokens into its turn, finalises the
   * persisted message, and stamps cost asynchronously off the post-stream
   * balance diff. Both `send` and `retry` funnel through here.
   */
  const streamIntoPlaceholder = useCallback(
    async (params: {
      /** The conversation the answer was asked in (`selectConversationId`
       *  then): every write about it goes there, whichever is open now. */
      conversationId: string | null;
      /** The request's controller, made when the send or regenerate started. */
      controller: AbortController;
      assistantMessageId: string;
      apiMessages: RoutstrChatMessage[];
      /** `image_url` parts included in `apiMessages` (drives the
       *  vision-aware candidate filter + request logs). */
      imageCount: number;
      flowId: string;
      retriedFromMessageId?: string;
      /** The figure the spend sheet put in front of the user, so the log can
       *  hold the promise and the outcome on one line. `null` when no sheet
       *  ran (a retry) or the model could not be priced. */
      shownSats?: number | null;
    }) => {
      const { conversationId, assistantMessageId, flowId, controller } = params;
      const shownSats = params.shownSats ?? null;
      let { apiMessages, imageCount } = params;

      const profile = useProfileStore.getState().activeAccountIndex;
      const storeState = useRoutstrStore.getState();
      const balanceSats = walletSats;
      const cachedModels = storeState.modelsCache?.data ?? [];
      // Resolved against `selectLineup`, which is `null` only on a true
      // first-run-offline (no catalog AND no snapshot): there is
      // deliberately no hardcoded id to guess at anymore, so surface it
      // instead of burning a round-trip on a dead model.
      // ONE chain, built once and never widened. Its `sealed` tag carries the
      // user's encryption choice through every later narrowing below — the
      // vision filter and the post-repoint recovery both derive from it, and
      // neither can reach a vendor the chain did not already contain.
      const { provider, tier, lineup, chain } = selectedChain(storeState);
      const displayedModel = resolveSelectedEntry(provider.id, tier.id, balanceSats, lineup);
      const primaryEntry = selectFromChain(chain, balanceSats);
      if (!primaryEntry) {
        // Three absences wearing one shape. A sealed chain that is
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
        dispatchTurn(assistantMessageId, { type: 'failed', error: { id, text: ERROR_COPY[id] } });
        return;
      }

      streamControllerRef.current?.abort();
      streamControllerRef.current = controller;
      preparingRef.current.delete(controller);

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
      const owner: Owner = {
        account: profile,
        anonymous: storeState.isAnonymousMode,
        conversationId,
      };
      const primaryModel = primaryEntry.modelId;
      // What the user approved, or — on a retry, which shows no sheet — what
      // the model they picked would have reserved. No candidate may reserve
      // more than this. On 2026-09-26 the sheet said 899 sats for the Auto
      // model, its upstream refused, and the walk paid 1,862 for the Max
      // sibling without asking; refunded, but a figure the user never saw
      // left their wallet under one they had.
      const budgetSats =
        shownSats ??
        reservedSatsForSend({
          entry: primaryEntry,
          models: cachedModels,
          messages: apiMessages,
          maxTokens: sendMaxTokens(primaryEntry.maxCompletionTokens),
        });
      let candidateChain = candidateEntries.map((e) => e.modelId);

      // Captures `Date.now()` for the live "Thinking for X seconds" counter
      // rendered by the bubble.
      dispatchTurn(assistantMessageId, { type: 'asked', startedAtMs: Date.now() });

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

      // Set once the answer settles. Its turn may then be gone (a finished
      // answer reads from its saved message), so a failure after that, in the
      // title or the cost log, must not give it a new, failed one.
      let settled = false;
      // Whether the answer still belongs to the account and conversation it
      // was asked in, on a screen still open, and has all along. Asked before
      // each request is paid for, up to the moment its token is handed over,
      // but not once it is: a switch then leaves the answer streaming into its
      // own conversation. Losing it aborts the request, so the abort paths
      // stop it, and the abort is what keeps it lost.
      const ownerWatch = watchOwner(owner);
      const stillOwned = () => {
        if (ownerWatch.change() !== 'none') controller.abort();
        return !controller.signal.aborted;
      };
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
        // The budget the winning candidate's request actually carried. Needed
        // after the stream to say what ran out, and by how much.
        let sentMaxTokens = 0;
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
          if (!stillOwned()) throw { status: 0, error: { type: 'aborted' } };
          const candidate = candidateChain[i];
          const candidateReserve = reservedSatsForSend({
            entry: candidateEntries[i] ?? null,
            models: cachedModels,
            messages: apiMessages,
            maxTokens: sendMaxTokens(candidateEntries[i]?.maxCompletionTokens),
          });
          if (budgetSats != null && candidateReserve != null && candidateReserve > budgetSats) {
            aiLog.warn('ai.send.candidate_over_budget', {
              flowId,
              candidate,
              candidateReserveSats: candidateReserve,
              budgetSats,
              attempt: i,
            });
            if (i === candidateChain.length - 1) {
              throw (
                lastConnectErr ?? {
                  status: 0,
                  error: {
                    message: 'The only model left reserves more than was approved',
                    type: 'over_budget',
                    code: 'over_budget',
                  },
                }
              );
            }
            continue;
          }
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
              //
              // One group per ATTEMPT, not per send. A walk that pays model A,
              // gets it all back, and then pays model B is two payments with
              // two outcomes — "refunded, the request failed" and whatever B
              // does — and under one id they rendered as three legs summing
              // to a figure that was neither. The message id still ties every
              // attempt to the same exchange.
              payment: {
                groupId: i === 0 ? flowId : `${flowId}#${i + 1}`,
                sessionId: conversationId ?? undefined,
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
              canDispatch: stillOwned,
            });
            stream = result.stream;
            costPromise = result.cost;
            modelToUse = candidate;
            sentMaxTokens = maxTokens;
            const current = useRoutstrStore.getState();
            // Adopt an accepted fallback without overwriting a newer choice.
            if (
              displayedModel?.modelId !== candidate &&
              !controller.signal.aborted &&
              useProfileStore.getState().activeAccountIndex === profile &&
              current.currentSessionId === storeState.currentSessionId &&
              current.nodeBaseUrl === requestNode &&
              current.selectedProvider === provider.id &&
              current.selectedTier === tier.id
            ) {
              const slot = slotForModel(selectLineup(current), candidate, tier.id);
              if (slot) current.setSelectedSlot(slot);
            }
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
            // The node could not USE the token — a keyset it does not know, a
            // mint it does not trust, a spent proof, its own wallet falling
            // over. Nothing about the model is in question and nothing about
            // the next model changes the payment, so paying the same node
            // again is paying to be refused again.
            if (isPaymentLayerFailure(err)) throw err;
            // An upstream decline: the node is healthy, the catalog is current
            // and the user's credit is fine — the AI provider behind THIS model
            // refused. Two shapes. A bare 402 the node forwarded from its
            // upstream, and — the commoner one — the node's own
            // `upstream_error` under the upstream's status with the whole
            // token refunded: the enclave or OpenRouter saying 404 to a model
            // the node's catalog still lists. Another candidate usually sits
            // behind a different upstream, or is simply a model the upstream
            // does serve, so advance without refreshing the lineup (there is
            // nothing stale to refresh) and without touching the balance.
            const upstreamDeclined =
              (status === 402 && !isWalletBalanceError(err)) || isUpstreamRefusal(err);
            if (upstreamDeclined) {
              declinedAttempts += 1;
              const code = (err as { error?: { code?: string } })?.error?.code;
              // Remembered per node and model, so the NEXT send starts from a
              // candidate that has not just failed here.
              markModelUnavailable(requestNode, candidate, { status: status ?? 0, code });
              // Skip every remaining candidate behind the upstream that just
              // refused — when the refusal is about the ACCOUNT. A node
              // fronts several upstream accounts and they fail independently:
              // when one runs out of credit (402), is rate-limited (429) or
              // is down (5xx), every model behind it answers identically, so
              // trying a sibling is paying to be refused again. Observed:
              // three candidates, three 402s, all `openrouter`. A 404 or 400
              // is about the MODEL — the same enclave served the sibling
              // minutes later — so siblings stay in the walk. Only narrows
              // when the node reports upstreams; otherwise the walk is
              // exactly as before.
              //
              // 424 is what nodes after v0.4.7 send for an upstream that is
              // down or timed out (`UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`,
              // routstr-core #771) instead of the 5xx that read as the node
              // itself being down. Same scope as a 5xx: the whole upstream.
              const accountScoped =
                status === 402 || status === 424 || status === 429 || (status ?? 0) >= 500;
              const declinedUpstream = accountScoped
                ? (candidateEntries[i]?.upstreamId ?? null)
                : null;
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
                status,
                code,
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
        // Rides on the last chunk of an OpenAI-compatible stream. The chunk
        // spine has always validated it; until now nothing read it, so an
        // answer cut off at the completion budget was indistinguishable from
        // one that simply finished.
        let finishReason: string | null = null;

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

          const choice = chunk.choices?.[0];
          if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
          const delta = choice?.delta;
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

            if (now - lastHapticAt >= HAPTIC_THROTTLE_MS) {
              lastHapticAt = now;
              void EnhancedHaptics.navigateHaptic();
            }
          }

          // The bubble renders the reasoning and the text as they arrive,
          // instead of waiting for the stream to end.
          if (reasoning || content)
            dispatchTurn(assistantMessageId, {
              type: 'streamed',
              text: fullContent,
              reasoning: fullReasoning,
            });

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
        // An answer that stopped because the budget ran out is one the user
        // paid for and did not get all of. It renders as a note under its own
        // content rather than as a failure — the content is real — and the
        // bubble offers to carry on from there.
        const truncated = isBudgetTruncation(finishReason);
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
          // The three fields that make `ROUTSTR_MAX_COMPLETION_TOKENS`
          // retunable from a log instead of from a guess: what we asked for,
          // what the model said about stopping, and roughly what it wrote at
          // the SDK's own 2.84 chars-per-token.
          maxTokens: sentMaxTokens,
          finishReason,
          approxCompletionTokens: Math.ceil((fullContent.length + fullReasoning.length) / 2.84),
          truncated,
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
          finalizeAssistantMessage(conversationId, assistantMessageId, {
            ...finalizePayload,
            thinkingDurationSec: thinkingSec,
            ...(displayedModel && displayedModel.modelId !== modelToUse
              ? {
                  modelSwitch: {
                    from: displayedModel.displayName,
                    to:
                      candidateEntries.find((entry) => entry.modelId === modelToUse)?.displayName ??
                      getModelDisplayName(modelToUse, cachedModels),
                  },
                }
              : {}),
            ...(costSats != null && costSats > 0 ? { costSats } : {}),
          });
        }
        settled = true;
        dispatchTurn(
          assistantMessageId,
          finalizePayload
            ? {
                type: 'answered',
                truncation: truncated ? { budgetTokens: sentMaxTokens } : null,
              }
            : { type: 'interrupted' }
        );
        aiLog.info('ai.send.assistant_finalized', {
          flowId,
          messageId: assistantMessageId,
          chars: fullContent.length,
        });

        if (conversationId !== null) updateSessionTitle(conversationId);

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
          // What the sheet promised, beside what it cost. Before this, the
          // figure the user approved existed nowhere but on screen, which is
          // why a 30x overstatement took a device report to find rather than
          // a log read.
          shownSats,
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
        if (settled) {
          aiLog.warn('ai.send.failed_after_answer', { flowId });
          span.end({ outcome: 'ok' });
          return;
        }
        if (isAbortError(err) || controller.signal.aborted) {
          aiLog.info('ai.send.aborted', { flowId });
          // The answer stays, with what had arrived, and can be asked again:
          // a question must never be left with no answer and nothing to press.
          dispatchTurn(assistantMessageId, { type: 'interrupted' });
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
        dispatchTurn(assistantMessageId, {
          type: 'failed',
          error: {
            id: presentation.id,
            text: presentation.text,
            ...(detail != null ? { detail } : {}),
          },
        });
        aiLog.info('ai.turn_error.shown', {
          flowId,
          messageId: assistantMessageId,
          errorId: presentation.id,
        });
      } finally {
        ownerWatch.stop();
        // Left without settling (the account changed under it): it ended
        // without an answer. Only this turn: a newer stream owns its own.
        dispatchTurn(assistantMessageId, { type: 'interrupted' });
      }
    },
    [finalizeAssistantMessage, updateSessionTitle, walletSats]
  );

  /**
   * Everything that is checked, and asked, before a request may spend: a
   * provider is chosen, it takes a mint the wallet holds, the wallet covers
   * what the model will hold, and the person agreed on the spend sheet to the
   * figure for this exact request. A send, a regenerate and the error pill's
   * Retry all pass through here, so none of them is a way to spend without
   * being asked.
   *
   * Resolves to the figure that was shown when the request may go ahead, and
   * to `null` when it may not; whatever there is to say has been said by then.
   */
  const passSendGate = useCallback(
    async (request: {
      flowId: string;
      watch: OwnerWatch;
      controller: AbortController;
      /** What was typed, trimmed; `null` for a regenerate, which types nothing. */
      typed: string | null;
      /** The request body the node will price, already assembled. */
      apiMessages: Awaited<ReturnType<typeof assembleApiMessages>>['messages'];
      imageParts: number;
      /** Images counted by the typical-case estimate when the model has no price. */
      attachedImages: number;
      /** What the quote is made from, read before anything was awaited. */
      quoted: {
        store: ReturnType<typeof useRoutstrStore.getState>;
        funds: typeof latestFunds.current;
        entry: LineupEntry | null;
      };
      /** The conversation moved or the screen closed while the sheet was open. */
      onLeft: (reason: 'conversation' | 'closed') => void;
    }): Promise<{ shownSats: number | null } | null> => {
      const { flowId, watch, controller, typed, apiMessages, quoted } = request;
      const { owner } = watch;
      const storeNow = quoted.store;
      const activeProvider = storeNow.userNodeBaseUrl;
      const plannedEntry = quoted.entry;
      // The gate's first question is whether anything was typed. A regenerate
      // re-asks a saved question that is already known not to be empty.
      const text = typed ?? REASKED_QUESTION;

      // The node's admission gate for this body, computed the way the node
      // computes it. `null` when the model carries no usable pricing, which
      // the gate turns back into the typical-case estimate and the sheet
      // labels as one.
      const plannedMaxTokens = sendMaxTokens(plannedEntry?.maxCompletionTokens);
      const reservedSats = text
        ? reservedSatsForSend({
            entry: plannedEntry,
            models: storeNow.modelsCache?.data ?? [],
            messages: apiMessages,
            maxTokens: plannedMaxTokens,
          })
        : null;

      const gate = evaluateSendGate({
        text,
        providerBaseUrl: activeProvider,
        providerMints: activeProvider ? (storeNow.knownProviders[activeProvider]?.mints ?? []) : [],
        heldMints,
        walletSats,
        entry: plannedEntry,
        imageCount: request.attachedImages,
        confirmSpend: storeNow.confirmSpend,
        reservedSats,
      });

      // The figure the user is about to be shown, recorded under the same
      // flowId as the money that follows it. It used to live only on screen,
      // which is why a 30x overstatement could only be found by someone
      // watching their own balance.
      const shownSats =
        gate.state === 'confirm' || gate.state === 'ready' ? gate.reserveSats : null;
      aiLog.info('ai.send.gate', {
        flowId,
        state: gate.state,
        shownSats,
        reserveKnown: gate.state === 'confirm' || gate.state === 'ready' ? gate.reserveKnown : null,
        model: plannedEntry?.modelId ?? null,
        maxTokens: plannedMaxTokens,
        promptMessages: apiMessages.length,
        imageParts: request.imageParts,
        walletSats,
      });
      switch (gate.state) {
        case 'empty':
          return null;
        case 'no-provider':
          // The one refusal with somewhere to go: the list is the answer.
          staticPopup('ai-no-provider');
          router.navigate('/(ai-flow)/providers');
          return null;
        case 'mint-not-accepted':
          staticPopup('ai-mint-not-accepted');
          return null;
        case 'insufficient-funds':
          navigateToAddFunds();
          return null;
        case 'confirm': {
          const allowed = await confirmSpend({
            modelName: gate.modelName,
            reserveSats: gate.reserveSats,
            reserveKnown: gate.reserveKnown,
          });
          if (!allowed) return null;
          const change = watch.change();
          const afterSheet = change === 'none' && controller.signal.aborted ? 'closed' : change;
          if (afterSheet === 'conversation' || afterSheet === 'closed') {
            request.onLeft(afterSheet);
            return null;
          }
          const current = useRoutstrStore.getState();
          const currentFunds = latestFunds.current;
          if (
            useProfileStore.getState().activeAccountIndex !== owner.account ||
            current.userNodeBaseUrl !== activeProvider ||
            current.selectedProvider !== storeNow.selectedProvider ||
            current.selectedTier !== storeNow.selectedTier ||
            current.lineup !== storeNow.lineup ||
            // The conversation itself is now part of the quote: the sheet
            // priced this tree, so a tree that moved while it was open is a
            // different request at a different price.
            current.conversationHistory !== storeNow.conversationHistory ||
            current.activeChildren !== storeNow.activeChildren ||
            currentFunds?.mintUrl !== quoted.funds?.mintUrl ||
            currentFunds?.balanceSats !== quoted.funds?.balanceSats
          ) {
            staticPopup('ai-payment-options-changed');
            return null;
          }
          break;
        }
        case 'ready':
          break;
      }
      return { shownSats };
    },
    [walletSats, heldMints, latestFunds, navigateToAddFunds]
  );

  const prepareSend = useCallback(
    async (
      controller: AbortController,
      watch: OwnerWatch,
      userMessage: string,
      attachments?: ChatAttachment[]
    ) => {
      // Every precondition in one place, decided before the optimistic bubbles
      // go in: declining after them would leave a user message with no answer
      // and nothing to retry. The gate is pure and exhaustive, so each way a
      // send can fail to start has a name and its own thing to say — a missing
      // provider, a mint the provider refuses and a declined confirmation used
      // to be indistinguishable from outside.
      const trimmed = userMessage.trim();
      const { owner } = watch;
      const storeNow = useRoutstrStore.getState();
      const quotedFunds = latestFunds.current;
      // Quoted from the same chain the send will walk, refused models last, so
      // the sheet names the model — and the figure — that actually goes first.
      const plannedEntry = selectFromChain(selectedChain(storeNow).chain, walletSats);
      const timestamp = Date.now();
      const userMessageId = `msg-${timestamp}-u`;
      const assistantMessageId = `msg-${timestamp + 1}-a`;
      const flowId = `ai-send-${timestamp}`;

      // Assembled BEFORE the gate, because the gate's whole job is now to
      // quote the node's reservation and the node computes that from this
      // exact body — messages, images and all. Quoting a typical turn and
      // sending a real one is how the sheet came to offer "up to 10 sats" for
      // a send that minted 307. Nothing here spends anything: it is the same
      // encode the send would have done a moment later, moved in front of the
      // question it answers.
      //
      // `createSession` clears `conversationHistory`, so a send that will
      // start one has no ancestry — mirrored here rather than run early,
      // because a declined send must not leave an empty session behind.
      const willStartNewSession = !isAnonymous && !currentSessionId;
      const activePath = willStartNewSession
        ? []
        : deriveActivePath(storeNow.conversationHistory, storeNow.activeChildren);
      const parentForUser: string | null = activePath[activePath.length - 1]?.id ?? null;
      const pendingUserMessage = {
        id: userMessageId,
        parentId: parentForUser,
        role: 'user' as const,
        content: trimmed,
        timestamp,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
      const answerPlaceholder = {
        id: assistantMessageId,
        parentId: userMessageId,
        role: 'assistant' as const,
        content: '',
        timestamp: timestamp + 1,
      };
      // Checked after every wait before the request. An account or
      // conversation that moved meanwhile would get the answer, and the bill,
      // for a question asked elsewhere; a screen that closed has no one to
      // show it to. Nothing is sent; a question asked in a saved conversation
      // is left there, unanswered, to be asked again.
      const whyNotSend = () => {
        const change = watch.change();
        return change === 'none' && controller.signal.aborted ? 'closed' : change;
      };
      const leaveQuestion = (reason: 'conversation' | 'closed') => {
        aiLog.info('ai.send.not_sent', { flowId, reason });
        if (owner.conversationId !== null)
          addMessages(owner.conversationId, [pendingUserMessage, answerPlaceholder]);
      };
      // Assembly (incl. the inline-image window and per-attachment encoding)
      // is shared with retry via `assembleApiMessages` so the two flows can't
      // diverge — and now also shared with the quote, so the priced request
      // and the sent request are the same object.
      //
      // Nothing typed is nothing to price, and the encode is the one expensive
      // step on this path — so a blank send skips it and lets the gate name
      // the situation it was always going to name.
      const { messages: apiMessages, imageCount } = trimmed
        ? await assembleApiMessages([...activePath, pendingUserMessage], encodeChatImage)
        : { messages: [], imageCount: 0 };
      const afterAssembly = whyNotSend();
      if (afterAssembly === 'account') {
        aiLog.info('ai.send.not_sent', { flowId, reason: afterAssembly });
        return;
      }
      if (afterAssembly !== 'none') {
        leaveQuestion(afterAssembly);
        return;
      }

      const passed = await passSendGate({
        flowId,
        watch,
        controller,
        typed: trimmed,
        apiMessages,
        imageParts: imageCount,
        attachedImages: attachments?.length ?? 0,
        quoted: { store: storeNow, funds: quotedFunds, entry: plannedEntry },
        onLeft: leaveQuestion,
      });
      if (!passed) return;
      const { shownSats } = passed;

      if (willStartNewSession) {
        createSession();
      }
      const conversationId = selectConversationId(useRoutstrStore.getState());

      // One write: a question is never saved without its answer, so one left
      // by a kill reads as an answer to ask again.
      addMessages(conversationId, [{ ...pendingUserMessage, pending: true }, answerPlaceholder]);

      try {
        await streamIntoPlaceholder({
          conversationId,
          controller,
          assistantMessageId,
          apiMessages,
          imageCount,
          flowId,
          shownSats,
        });
      } finally {
        // The user message's optimistic spinner clears the moment the
        // streaming round-trip resolves — success or error, the request
        // left our hands. Errors surface as a pill on the assistant
        // placeholder, not on the user bubble's check.
        setMessagePending(conversationId, userMessageId, false);
      }
    },
    [
      isAnonymous,
      currentSessionId,
      createSession,
      addMessages,
      setMessagePending,
      streamIntoPlaceholder,
      walletSats,
      latestFunds,
      passSendGate,
    ]
  );

  // `isSending` (React state) only blocks subsequent sends after the first
  // `setStatus` flush — a rapid double-tap lands both calls into
  // `streamIntoPlaceholder` before the disabled flag commits, billing the
  // user twice and corrupting the active branch tree. `useSingleFlight`
  // drops the duplicate at the ref level.
  const sendInner = useCallback(
    (userMessage: string, attachments?: ChatAttachment[]) =>
      withRequestController(preparingRef.current, (controller, watch) =>
        prepareSend(controller, watch, userMessage, attachments)
      ),
    [prepareSend]
  );
  const send = useSingleFlight(sendInner);

  /**
   * Spawn a new sibling assistant under the same parent as `messageId`,
   * stream a fresh response, and flip the active branch to the new sibling.
   * The chat list re-derives off `activeChildren` so descendants of the old
   * sibling (follow-up exchanges) drop out of view immediately and can be
   * brought back via the bubble's chevron nav.
   */
  const prepareRetry = useCallback(
    async (controller: AbortController, watch: OwnerWatch, messageId: string) => {
      const { owner } = watch;
      const stateNow = useRoutstrStore.getState();
      const quotedFunds = latestFunds.current;
      // Quoted from the chain the request will walk, as a send's is.
      const plannedEntry = selectFromChain(selectedChain(stateNow).chain, walletSats);
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
      // The answer stays in its own conversation, to be asked again from
      // there, when the account or conversation moved or the screen closed.
      const change = watch.change();
      if (change !== 'none' || controller.signal.aborted) {
        aiLog.info('ai.retry.not_sent', {
          messageId,
          reason: change === 'none' ? 'closed' : change,
        });
        return;
      }

      const { conversationId } = owner;
      const timestamp = Date.now();
      const newAssistantId = `msg-${timestamp}-r`;
      const flowId = `ai-retry-${timestamp}`;
      const parentId = original.parentId ?? null;

      // Asking again costs what asking did, so it is checked and asked the
      // way a send is, before the new answer's bubble goes in. Declined or
      // refused, the answer that was there stays as it was.
      const passed = await passSendGate({
        flowId,
        watch,
        controller,
        typed: null,
        apiMessages,
        imageParts: imageCount,
        attachedImages: imageCount,
        quoted: { store: stateNow, funds: quotedFunds, entry: plannedEntry },
        onLeft: (reason) => aiLog.info('ai.retry.not_sent', { messageId, reason }),
      });
      if (!passed) return;

      addMessages(conversationId, [
        {
          id: newAssistantId,
          parentId,
          role: 'assistant',
          content: '',
          timestamp,
        },
      ]);
      // Flip immediately so the chat list shows the streaming sibling as
      // the active branch. The user can navigate back to the original via
      // the bubble's chevron nav.
      if (parentId != null) {
        setActiveBranch(parentId, newAssistantId);
      }

      await streamIntoPlaceholder({
        conversationId,
        controller,
        assistantMessageId: newAssistantId,
        apiMessages,
        imageCount,
        flowId,
        shownSats: passed.shownSats,
        retriedFromMessageId: messageId,
      });
    },
    [addMessages, setActiveBranch, streamIntoPlaceholder, passSendGate, latestFunds, walletSats]
  );

  // Retry shares the double-tap exposure with `send`: a rapid tap on the
  // regenerate chevron would spawn two sibling assistants and bill twice.
  const retryInner = useCallback(
    (messageId: string) =>
      withRequestController(preparingRef.current, (controller, watch) =>
        prepareRetry(controller, watch, messageId)
      ),
    [prepareRetry]
  );
  const retry = useSingleFlight(retryInner);

  return { send, retry, isSending };
}
