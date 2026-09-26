import { z } from 'zod';

import {
  CashuRedemptionError,
  CoreInternalError,
  FailoverError,
  InsufficientBalanceError,
  InvalidTokenError,
  MintError,
  MintUnreachableError,
  NoProvidersAvailableError,
  ProviderError,
  TokenAlreadySpentError,
  TokenConsumedError,
  type Model,
} from '@routstr/sdk/browser';

import { fetchNodeInfo } from './providers';
import { isE2eeModelId } from './lineup';
import { selectPayingMint } from './payingMint';
import {
  createRequestDeadline,
  RESPONSE_IDLE_DEADLINE_MS,
  type RequestDeadline,
} from './requestDeadline';
import type { SdkRefusal } from './sdk/sdkLogger';
import {
  acceptedMintsForProvider,
  getRoutstrClient,
  scheduleRecoverySweeps,
  seedProviderCatalog,
  sweepUnsettledPayments,
} from './sdk/client';
import { withPaymentScope, type PaymentContext } from './sdk/paymentScope';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { apiLog } from '../logger';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { isAbortError, type RequestControls } from 'wallet/safeFetch';

const ROUTSTR_DEFAULT_BASE_URL = 'https://api.routstr.com/v1';

/**
 * Node override served by nagg's `/app/ai-lineup` (and re-applied from the
 * persisted `routstrStore.nodeBaseUrl` on hydrate). Lets a nagg deploy
 * repoint already-shipped builds at a different Routstr node if the default
 * one dies — the strongest OTA lever the lineup endpoint carries. Module
 * state keeps request origins stable while the store applies lineup/hydration changes.
 */
let routstrBaseUrlOverride: string | null = null;
let metadataReady: { origin: string; ownsScope: () => boolean; promise: Promise<void> } | null =
  null;

/** Set (or clear with null) the Routstr node base URL, e.g.
 *  "https://api.routstr.com". The `/v1` path segment is appended here so the
 *  caller passes a plain origin. */
export function setRoutstrNodeBaseUrl(url: string | null): void {
  const trimmed = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  routstrBaseUrlOverride = trimmed ? `${trimmed}/v1` : null;
}

/**
 * Whether the user has chosen a provider.
 *
 * There is deliberately no default. Picking a provider on someone's behalf
 * makes this app the arbiter of who gets paid for AI, and silently sends the
 * user's money to whoever we favoured — so nothing is sent until they choose.
 * The old `ROUTSTR_DEFAULT_BASE_URL` remains only as the shape a URL takes.
 */
function hasRoutstrProvider(): boolean {
  return routstrBaseUrlOverride != null;
}

function routstrBaseUrl(): string {
  return routstrBaseUrlOverride ?? ROUTSTR_DEFAULT_BASE_URL;
}

/** The error every path raises before a provider is chosen. */
function noProviderChosen(): RoutstrError {
  return {
    status: 0,
    error: {
      message: 'Choose an AI provider first',
      code: 'no_provider',
      type: 'no_provider',
      details: undefined,
    },
  };
}

/**
 * The node's origin, without the `/v1` API prefix.
 *
 * `@routstr/sdk` joins a base URL and a path itself, and asks that base for
 * `/v1/info` when it wants to know who it is talking to. Handing it the `/v1`
 * form produces `/v1/v1/info`, so the prefix travels in the path instead.
 */
function routstrOrigin(): string {
  return routstrBaseUrl().replace(/\/v1$/, '');
}

/** The mint the wallet spends from. Lazily required so a Routstr consumer does
 *  not drag the profile-scoped mint store into its module graph; Metro handles
 *  both spellings, Jest's CJS VM only this one. */
function selectedMintUrl(): string | undefined {
  const { useMintStore } =
    require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
  return useMintStore.getState().selectedMint;
}

/**
 * The mint this request is paid from.
 *
 * A Routstr node redeems tokens from a published list of mints and refuses
 * everything else, so "which mint" is not the wallet's choice alone. The
 * wallet's selected mint wins when the node accepts it; otherwise the largest
 * accepted balance does, because paying from an accepted mint the user already
 * holds is better than a refusal they cannot act on.
 *
 * This is deliberately decided here rather than left to the SDK. Its own
 * candidate order puts the biggest balance first and the caller's preference
 * second, which is how a request came to be paid from `mint.sovran.money`
 * against a node that only takes Minibits.
 */
async function payingMintUrl(origin: string): Promise<PayingMintDecision> {
  const pending = metadataReady;
  if (pending?.origin === origin && pending.ownsScope()) await pending.promise;
  const selected = selectedMintUrl();
  const accepted = await acceptedMintsForProvider(origin);
  const { cocoWalletAdapter } =
    require('./sdk/walletAdapter') as typeof import('./sdk/walletAdapter');
  const balances = await cocoWalletAdapter.getBalances();
  const paying = selectPayingMint({ selectedMint: selected, acceptedMints: accepted, balances });
  if (paying)
    return {
      mintUrl: paying.mintUrl,
      // Which mint paid, and whether it was the user's own choice, is the
      // first thing a failed attempt has to say: a node that only takes
      // Minibits and a wallet whose Minibits is down produce the same
      // "provider unavailable" as a node that is genuinely gone.
      matchedSelection: selected != null && paying.mintUrl === selected,
      acceptedMints: accepted?.length ?? 0,
      walletMints: Object.keys(balances).length,
    };

  // Nothing the node takes. Said plainly, because the user can act on it —
  // switch mint, or switch provider — and every other phrasing of this ends up
  // reading as "insufficient balance" against a funded wallet.
  const refusal: RoutstrError = {
    status: 0,
    error: {
      message: 'This provider does not accept any of your mints',
      code: 'mint_not_accepted',
      type: 'mint_not_accepted',
      details: undefined,
    },
  };
  throw refusal;
}

/** Which mint paid, and what the choice was made from. */
interface PayingMintDecision {
  mintUrl: string;
  matchedSelection: boolean;
  acceptedMints: number;
  walletMints: number;
}

/** The host of a URL, without leaning on React Native's partial `URL`. */
function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z]+:\/\/([^/?#]+)/i.exec(value)?.[1];
}

/**
 * The upstream account a model is billed to (`openrouter`, `ppqai`, `tinfoil`,
 * `generic`…), read from the lineup the app already holds.
 *
 * A node whose OpenRouter credit has run out still serves a complete catalog
 * and still takes payment, then forwards the upstream's 404 — so "this node is
 * broken" and "this node's account with one upstream is broken" produce the
 * same refusal. Carrying the id on the attempt is what lets a run across many
 * providers be grouped by the thing they actually share.
 *
 * Best-effort: a missing store or a model the lineup does not carry is a
 * missing field, never a failed request.
 */
function upstreamIdForModel(model: string): string | undefined {
  try {
    const { lineup } = routstrStoreState();
    if (!lineup) return undefined;
    for (const vendor of Object.values(lineup)) {
      for (const entry of [vendor?.auto, vendor?.pro, vendor?.max]) {
        if (entry?.modelId === model) return entry.upstreamId ?? undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * `max_tokens` sent with every chat completion — the completion budget one
 * answer may spend, and therefore the completion side of the reservation the
 * node holds for it.
 *
 * Sending it at all is not optional: `@routstr/sdk`'s `getRequiredSatsForModel`
 * (and routstr-core's `calculate_discounted_max_cost` behind it) discounts the
 * completion side of the reservation ONLY when the request bounds it. Omit it
 * and the node reserves the model's entire `max_completion_cost`. So this
 * number is the lever that makes the reservation smaller, never larger.
 *
 * It is 2000 because that is what this app already says a chat turn writes:
 * `TYPICAL_COMPLETION_TOKENS` in `features/ai/lib/format.ts` is defined to be
 * this same constant, deliberately. Two different figures were the bug — the
 * cost column priced 2000 completion tokens while the wire asked for 4096, so
 * every sat figure the user saw was derived from a request we were not making.
 * One constant, one meaning: what a turn is expected to write is what we
 * reserve for it.
 *
 * Being wrong low is now recoverable and visible: a stream that ends on
 * `finish_reason: 'length'` is recorded (`features/ai/lib/turnTruncation.ts`)
 * and the bubble says so and offers to continue. Being wrong high is not — it
 * is the user's money locked for the duration, and every refund race and stuck
 * token scales with it. Retune it against `ai.stream.complete`, which records
 * `maxTokens`, `finishReason` and `approxCompletionTokens` on every answer for
 * exactly this purpose.
 *
 * The send path clamps it under the model's own ceiling
 * (`top_provider.max_completion_tokens`) via `sendMaxTokens`.
 */
export const ROUTSTR_MAX_COMPLETION_TOKENS = 2000;

/**
 * Per-request budget for routstr endpoints. The chat APIs can take longer
 * than the app's shared `DEFAULT_TIMEOUT_MS` (10s) — match the streaming-side
 * 60s budget for the bare-fetch endpoints so a slow upstream doesn't
 * surface as a fake timeout.
 */
const ROUTSTR_TIMEOUT_MS = 30_000;

/**
 * Minimal shape of an OpenAI-compatible chat completion stream chunk —
 * captures the fields useAiSend.ts actually reads (`choices[0].delta.*`).
 * Defining locally avoids shipping the full `openai` SDK in production.
 *
 * Validated at the SSE-chunk boundary by `ChatCompletionChunkSpine` below
 * so a malformed line warns-and-skips rather than crashing the stream.
 */
const ChatCompletionDeltaSpine = z.looseObject({
  content: z.string().nullish(),
  reasoning_content: z.string().nullish(),
  reasoning: z.string().nullish(),
  message: z.looseObject({ content: z.string().nullish() }).nullish(),
  text: z.string().nullish(),
});

const ChatCompletionChunkSpine = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        delta: ChatCompletionDeltaSpine.optional(),
        finish_reason: z.string().nullish(),
      })
    )
    .optional(),
});

type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSpine>;

/**
 * Spine validators for the JSON envelopes routstr returns. Like
 * `apiClient.MintInfoSpine`, these intentionally validate only the fields
 * we read — Postel's Law leaves room for the upstream to add fields without
 * forcing a Sovran release. Hostile or misconfigured upstreams that mangle
 * `balance` or `data` into non-numbers/non-arrays are rejected before they
 * reach the wallet UI.
 */
// Per-field `.catch(undefined)` keeps the spine tolerant one level deeper
// than the envelope: these are the fields `deriveLineup` consumes, and a
// type drift in any ONE of them must degrade that field (the row then
// fails lineup qualification or ranks last), never reject the whole
// response — rejecting a 200 wholesale would silently drop the entire
// model menu the way the old unvalidated cast silently drifted.
const undef = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

const ModelsResponseSpine = z.looseObject({
  data: z.array(
    z.looseObject({
      enabled: z.boolean().optional(),
      created: undef(z.number()),
      context_length: undef(z.number()),
      name: undef(z.string()),
      canonical_slug: undef(z.string().nullable()),
      // The node's upstream account for this row. `deriveLineup` carries it so
      // the send path can tell a dead upstream from a dead node.
      upstream_provider_id: undef(z.string().nullable()),
      architecture: undef(
        z.looseObject({
          input_modalities: undef(z.array(z.string())),
          output_modalities: undef(z.array(z.string())),
        })
      ),
      sats_pricing: undef(
        z
          .looseObject({
            prompt: undef(z.number()),
            completion: undef(z.number()),
            request: undef(z.number()),
            image: undef(z.number()),
            max_cost: undef(z.number()),
          })
          .nullable()
      ),
    })
  ),
});

const BalanceSpine = z.looseObject({
  balance: z.number().optional(),
  total_spent: z.number().optional(),
  api_key: z.string().optional(),
  reserved: z.number().optional(),
});

const TopUpSpine = z.looseObject({
  msats: z.number().optional(),
});

// ── Types ────────────────────────────────────────────────────────────────

interface BalanceResponse {
  balance: number;
  total_spent?: number;
  api_key?: string;
  reserved?: number;
}

interface TopUpResponse {
  added_amount: number;
}

interface RoutstrError {
  status: number;
  error: {
    message: string;
    type: string;
    code?: string;
    details?: {
      required?: number;
      available?: number;
      retry_after?: number;
      /**
       * Whether the node handed the request's whole token back with this
       * refusal. `true` is the node saying "my payment layer is fine, it was
       * the request" — the one fact that makes another model on the same node
       * worth paying for. Absent when nothing was ever paid.
       */
      refunded?: boolean;
    };
  };
}

const ErrorDetailsSchema = z.object({
  required: undef(z.number().nonnegative()),
  available: undef(z.number().nonnegative()),
  retry_after: undef(z.number().nonnegative()),
});

/**
 * `error.code`, coerced from either spelling. Routstr's own errors use string
 * codes (`insufficient_balance`, `model_not_found`); a forwarded upstream error
 * — routstr-core `forward_upstream_error_response` returns the AI provider's
 * JSON body verbatim under the provider's status — usually carries the numeric
 * HTTP status instead. Dropping the number the way a bare `z.string()` does
 * leaves `type` to fall through to `unknown_error`, which is exactly how an
 * upstream 402 came to be indistinguishable from a wallet 402.
 */
const ErrorCodeSchema = z
  .union([z.string(), z.number().transform(String)])
  .optional()
  .catch(undefined);
const ErrorBodySchema = z.union([
  z.object({
    error: z.object({
      message: z.string(),
      type: undef(z.string()),
      code: ErrorCodeSchema,
      details: undef(ErrorDetailsSchema),
    }),
  }),
  z.object({
    detail: z.union([
      z.string(),
      z.object({
        reason: undef(z.string()),
        message: undef(z.string()),
        amount_required_msat: undef(z.number().nonnegative()),
        balance_msat: undef(z.number().nonnegative()),
      }),
    ]),
  }),
  z.object({ message: z.string(), type: undef(z.string()), details: undef(ErrorDetailsSchema) }),
]);

type ParsedErrorData = RoutstrError['error'];

// ── Error Handling ───────────────────────────────────────────────────────

async function parseErrorResponse(response: Response): Promise<ParsedErrorData> {
  const fallback = {
    message: response.statusText || `HTTP ${response.status}`,
    type: 'unknown_error',
  };
  if (response.headers.get('content-type')?.includes('text/html')) {
    return {
      message: await extractErrorMessageFromHTML(response),
      type: response.status >= 500 ? 'server_error' : 'client_error',
    };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    // An empty or non-JSON body under a JSON content type. `fallback.message`
    // is then the platform's status text ("payment required" on iOS), which
    // reads like a server explanation but is the app talking to itself — so
    // record that there was nothing to read.
    apiLog.warn('api.routstr.error_body_unreadable', { status: response.status });
    return fallback;
  }
  try {
    const parsed = ErrorBodySchema.safeParse(raw);
    if (!parsed.success) {
      // A shape none of the three envelopes match. Keep a bounded preview: the
      // alternative is `fallback`, whose message is the platform status text,
      // and losing the body is precisely what hid this class of failure.
      apiLog.warn('api.routstr.error_body_unrecognized', {
        status: response.status,
        keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 8) : typeof raw,
        preview: JSON.stringify(raw).slice(0, 200),
      });
      return fallback;
    }
    const body = parsed.data;
    let result: ParsedErrorData;
    if ('error' in body) {
      result = { ...body.error, type: body.error.type ?? body.error.code ?? 'unknown_error' };
    } else if ('detail' in body) {
      result =
        typeof body.detail === 'string'
          ? { message: body.detail, type: 'unknown_error' }
          : {
              message: body.detail.reason || body.detail.message || fallback.message,
              type: 'unknown_error',
              details: {
                required: body.detail.amount_required_msat,
                available: body.detail.balance_msat,
              },
            };
    } else {
      result = { ...body, type: body.type ?? 'unknown_error' };
    }
    const match = result.message.match(/(\d+)\s*mSats?\s*required.*?(\d+)\s*available/i);
    if (match)
      result.details = {
        ...result.details,
        required: result.details?.required ?? Number(match[1]),
        available: result.details?.available ?? Number(match[2]),
      };
    return result;
  } catch {
    return fallback;
  }
}

/** Extract a human-readable message from Cloudflare / gateway HTML error pages. */
async function extractErrorMessageFromHTML(response: Response): Promise<string> {
  try {
    const html = await response.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1];
      const errorMatch = title.match(/(\d+):\s*(.+)/);
      if (errorMatch) return `${errorMatch[1]} ${errorMatch[2]}`;
      return title.replace(/^[^|]+\s*\|\s*/, '');
    }
    return response.statusText || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Lazy store access. A static import would create an api ↔ store cycle
 * (the store imports this module's types and the shared lineup), so the
 * store is resolved at call time — via `require` rather than a dynamic
 * `import()` because Metro handles both but Jest's CJS VM can only
 * execute the former, and the 401/402 branches below are exactly the
 * paths that need regression tests.
 */
function routstrStoreState() {
  const { useRoutstrStore } =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  return useRoutstrStore.getState();
}

function captureRequestScope(): () => boolean {
  const profile = useProfileStore.getState().activeAccountIndex;
  const node = routstrBaseUrl();
  return () =>
    useProfileStore.getState().activeAccountIndex === profile && routstrBaseUrl() === node;
}

function applyResponseChange(
  response: Response,
  requestKey: string,
  ownsScope: () => boolean
): string {
  const token = response.headers.get('x-cashu');
  if (token && ownsScope() && routstrStoreState().apiKey === requestKey) {
    routstrStoreState().applyChangeToken(token);
    return routstrStoreState().apiKey ?? requestKey;
  }
  return requestKey;
}

const ErrorEvidenceSchema = z.object({
  status: z.number(),
  error: z.object({ message: z.string().optional(), type: z.string().optional() }).optional(),
});

const BalanceEvidenceSchema = z.object({
  status: z.number(),
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.string().optional(),
      details: z
        .object({
          required: z.number().optional(),
          available: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Markers routstr-core stamps on a 402 it raised about THIS key's balance:
 *  `insufficient_quota`/`insufficient_balance` on the Bearer path
 *  (`routstr/auth.py`), `minimum_balance_required` on the X-Cashu path
 *  (`routstr/payment/helpers.py`). */
const WALLET_BALANCE_TYPES = new Set(['insufficient_quota', 'minimum_balance_required']);
const WALLET_BALANCE_CODES = new Set(['insufficient_balance', 'minimum_balance_required']);

/**
 * True only for a 402 the NODE raised about this key's wallet balance.
 *
 * A bare `status === 402` is not enough. `forward_upstream_error_response` in
 * routstr-core hands the AI provider's own JSON error body back verbatim under
 * the provider's status, so an upstream that declines for its own reasons — an
 * operator out of credit, a provider-side payment fault — arrives as a 402 that
 * has nothing to do with the user's ecash. Observed on device: 100 sats
 * credited, 0 reserved, a model whose worst case is 19.86 sats, and a 402 whose
 * body carried no routstr marker at all. Treating that as "Insufficient
 * balance" sends the user to top up a wallet that is already funded, and no
 * amount of topping up can clear it.
 *
 * A wallet 402 must carry one of routstr's markers, or the msat figures its
 * message embeds (`parseErrorResponse` lifts those out of the prose).
 */
export function isWalletBalanceError(error: unknown): boolean {
  const parsed = BalanceEvidenceSchema.safeParse(error);
  if (!parsed.success || parsed.data.status !== 402) return false;
  const detail = parsed.data.error;
  if (detail?.type && WALLET_BALANCE_TYPES.has(detail.type)) return true;
  if (detail?.code && WALLET_BALANCE_CODES.has(detail.code)) return true;
  return typeof detail?.details?.required === 'number';
}

export function isModelRejectedError(error: unknown, model: string): boolean {
  const parsed = ErrorEvidenceSchema.safeParse(error);
  if (!parsed.success || ![400, 404].includes(parsed.data.status)) return false;
  const message = parsed.data.error?.message?.toLowerCase() ?? '';
  return /model/i.test(message) || (model.length > 0 && message.includes(model.toLowerCase()));
}

export function isRoutstrNodeFailure(error: unknown): boolean {
  const parsed = ErrorEvidenceSchema.safeParse(error);
  if (!parsed.success) return false;
  const { status, error: detail } = parsed.data;
  return (
    (status === 0 && detail?.type !== 'aborted') ||
    status === 404 ||
    (status >= 500 && status < 600)
  );
}

const RefusalEvidenceSchema = z.object({
  status: z.number(),
  error: z
    .object({
      type: z.string().optional(),
      code: z.string().optional(),
      details: z.object({ refunded: z.boolean().optional() }).optional(),
    })
    .optional(),
});

/**
 * The node's own vocabulary for "your payment did not work", across every
 * routstr-core release (`routstr/wallet.py` `classify_redemption_error`, plus
 * the X-Cashu preflight's `minimum_balance_required` and the untrusted-mint
 * refusal). None of these is about the model, so none of them is a reason to
 * pay the same node again for a different one.
 */
const PAYMENT_LAYER_TYPES = new Set([
  'invalid_token',
  'cashu_error',
  'mint_error',
  'mint_unreachable',
  'mint_timeout',
  'mint_rate_limited',
  'token_already_spent',
  'token_consumed',
  'untrusted_mint',
  'minimum_balance_required',
  'insufficient_quota',
  'api_error',
  'mint_not_accepted',
]);

/**
 * Whether the node refused because of the payment rather than the request.
 *
 * Decided from the node's `type`, and — when the SDK's typed error carried no
 * body — from the classification `fromSdkError` gave its redemption classes.
 */
export function isPaymentLayerFailure(error: unknown): boolean {
  const parsed = RefusalEvidenceSchema.safeParse(error);
  if (!parsed.success) return false;
  const type = parsed.data.error?.type;
  return type != null && PAYMENT_LAYER_TYPES.has(type);
}

/**
 * Whether the node took the payment, asked its upstream for THIS model, was
 * refused, and refunded — which says the node works and the model does not.
 *
 * Two signals, either sufficient. A node from v0.4.5 on labels it: any
 * non-200 from the upstream in X-Cashu mode comes back as
 * `{"type":"upstream_error","code":<upstream status>}` under that status with
 * the whole token in `X-Cashu`. An older node forwards the upstream body as it
 * was, unlabelled — so a refusal under a 4xx/5xx that is not one of the
 * node's own payment-layer types, and that came with the full refund, is read
 * the same way. The refund is the load-bearing fact: a node that gave the
 * money back has a working wallet, a working mint connection and a working
 * database, and what failed was the one thing left.
 *
 * On 2026-09-26 six of eight failed sends were this — `privateprovider.xyz`
 * and `ai.redsh1ft.com` answering the enclave's 404 for a model their catalog
 * listed, while a sibling model on the same node worked minutes later. None
 * of the six tried the sibling.
 */
export function isUpstreamRefusal(error: unknown): boolean {
  const parsed = RefusalEvidenceSchema.safeParse(error);
  if (!parsed.success) return false;
  const { status, error: detail } = parsed.data;
  if (status < 400) return false;
  if (detail?.type === 'upstream_error') return true;
  if (isPaymentLayerFailure(error)) return false;
  return detail?.details?.refunded === true;
}

/**
 * Throw a typed RoutstrError from a failed fetch Response.
 * Shared by all API functions to avoid duplicating the parse → format → throw chain.
 */
async function throwResponseError(
  response: Response,
  requestKey?: string,
  balanceKey = requestKey,
  ownsScope: () => boolean = () => true
): Promise<never> {
  const errorData = await parseErrorResponse(response);
  const status = response.status;
  // `message` and `code` are the only fields that separate a wallet 402 from a
  // 402 the node forwarded verbatim from the AI provider upstream. Dropping
  // them — as this log used to — makes the difference unobservable from the
  // app, which is how every 402 came to be reported as "Insufficient balance".
  // The logger's own sanitizer redacts embedded secrets and caps length; the
  // slice keeps a hostile upstream from filling a line with prose.
  apiLog.warn('api.routstr.http_error', {
    status,
    type: errorData.type,
    code: errorData.code,
    message: errorData.message.slice(0, 200),
    requestId: response.headers.get('x-routstr-request-id') ?? undefined,
    requiredMsats: errorData.details?.required,
    availableMsats: errorData.details?.available,
  });

  // A 401 retires the credential from active use — but it is ARCHIVED, never
  // deleted. The key is `sk-<sha256(token)>`, a row in one node's database, and
  // the only bearer instrument for whatever was deposited there; deleting it
  // makes that balance permanently unreachable. Worse, the message this branch
  // reads cannot tell the two cases apart: "the node that issued this key says
  // it is spent" and "a node that never issued it has never heard of it" both
  // match. A repoint produces the second, so the old behaviour turned a routine
  // node change into silent loss. Archive, and let reclaim ask each node.
  const ownsKey = ownsScope() && requestKey != null && routstrStoreState().apiKey === requestKey;
  if (status === 401 && ownsKey && requestKey != null) {
    if (/invalid|expired|spent|unknown|not found|revoked/i.test(errorData.message)) {
      const state = routstrStoreState();
      apiLog.warn('api.routstr.api_key_retired', { hadBalance: (state.balance ?? 0) > 0 });
      state.archiveAccount(state.nodeBaseUrl, requestKey, state.balance);
      state.clearApiKey();
      state.clearBalance();
    } else {
      apiLog.warn('routstr.auth.kept_key');
    }
  }

  // 402 carries the server's true available balance ("X mSats required …
  // Y available") — sync it into the store. The local balance otherwise
  // only refreshes after a SUCCESSFUL stream, so a drained (or
  // reservation-held) key leaves the UI gating sends against a stale
  // figure forever: every affordability check passes client-side, every
  // send 402s, and the insufficient-balance popup loops. Syncing here
  // makes the balance pill, picker fades, and estimates truthful the
  // moment the server disagrees.
  if (
    status === 402 &&
    ownsScope() &&
    balanceKey != null &&
    routstrStoreState().apiKey === balanceKey
  ) {
    const available = errorData.details?.available;
    if (typeof available === 'number' && isFinite(available) && available >= 0) {
      apiLog.info('api.routstr.balance_synced_from_402', { availableMsats: available });
      routstrStoreState().setBalance(available);
    }
  }

  throw {
    status,
    error: {
      message: errorData.message,
      code: errorData.code,
      type: errorData.type || 'unknown_error',
      details: errorData.details,
    },
  } as RoutstrError;
}

/** Wrap a caught unknown into a RoutstrError (re-throws if already one). */
function toRoutstrError(error: unknown): never {
  if (error && typeof error === 'object' && 'status' in error) throw error;
  if (error instanceof Error && error.name === 'TimeoutError') {
    throw {
      status: 0,
      error: { message: error.message, type: 'timeout', code: 'timeout' },
    } satisfies RoutstrError;
  }
  if (isAbortError(error)) {
    throw {
      status: 0,
      error: { message: 'Request cancelled', type: 'aborted' },
    } as RoutstrError;
  }
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Network error';
  throw { status: 0, error: { message, type: 'network_error' } } as RoutstrError;
}

export interface RoutstrModel {
  id: string;
  name: string;
  description: string;
  created: number;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: number;
    completion: number;
    request: number;
    image: number;
    web_search: number;
    internal_reasoning: number;
    max_prompt_cost: number;
    max_completion_cost: number;
    max_cost: number;
  };
  sats_pricing: {
    prompt: number;
    completion: number;
    request: number;
    image: number;
    web_search: number;
    internal_reasoning: number;
    max_prompt_cost: number;
    max_completion_cost: number;
    max_cost: number;
  };
  per_request_limits: any;
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  enabled: boolean;
  upstream_provider_id: string | null;
  canonical_slug: string | null;
  alias_ids: string[] | null;
}

interface ModelsResponse {
  data: RoutstrModel[];
}

/**
 * Read one Routstr JSON envelope: HTTP status first, then shape. A body that
 * doesn't parse is a hard failure — the per-field `?? 0` defaults the callers
 * apply are for absent optionals in a well-formed envelope, not a stand-in for
 * a response that isn't one, and silently zeroing a balance is the shape of
 * error that gates sends against a number the server never sent.
 *
 * `invalidShapeEvent` is passed as a whole literal rather than composed here so
 * every log-doctor scope stays greppable at its call site.
 */
async function readRoutstrEnvelope<TSpine extends z.ZodType>(
  response: Response,
  spine: TSpine,
  meta: { route: string; invalidShapeEvent: string },
  requestKey?: string,
  balanceKey = requestKey,
  ownsScope: () => boolean = () => true
): Promise<z.infer<TSpine>> {
  if (!response.ok) await throwResponseError(response, requestKey, balanceKey, ownsScope);

  const validated = spine.safeParse(await response.json());
  if (!validated.success) {
    apiLog.warn(meta.invalidShapeEvent, { issues: validated.error.issues.length });
    throw new Error(`Routstr ${meta.route} returned a malformed envelope`);
  }
  return validated.data;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Hand this node's catalog and accepted-mint list to the SDK.
 *
 * `/v1/info` is unauthenticated, cheap and stable, and `mints` is the one
 * field that decides whether the user can pay this provider at all: a token
 * minted anywhere else is refused. Absent or empty means the node does not
 * say, which the SDK reads as "any mint".
 */
async function seedFromNode(
  origin: string,
  models: Model[],
  ownsScope: () => boolean
): Promise<void> {
  const known = routstrStoreState().knownProviders[origin];
  await seedProviderCatalog(origin, models, known?.mints);
  if (!ownsScope()) return;
  // Whether this provider can answer without reading the prompt is only
  // knowable from its catalog, and its catalog is three quarters of a
  // megabyte — far too heavy to probe every row of a picker with. Recording
  // it here means the one provider we DID read is marked, and the picker
  // fills in as providers are used.
  // Only a catalog read can answer this, and this app is the one that read it.
  routstrStoreState().observeProviders('catalog', {
    [origin]: {
      e2ee: models.some((model) => isE2eeModelId(model.id)),
    },
  });
  // The catalog can be used as soon as its prices are seeded. Metadata from
  // an optional endpoint must not hold the model picker open for its timeout.
  const promise = fetchNodeInfo(origin)
    .then(async (info) => {
      if (!info || !ownsScope()) return;
      await seedProviderCatalog(origin, models, info.mints);
      if (!ownsScope()) return;
      routstrStoreState().observeProviders('self', {
        [origin]: {
          name: info.name,
          description: info.description,
          version: info.version,
          mints: info.mints,
          pubkey: info.pubkey,
        },
      });
    })
    .catch(() => apiLog.warn('routstr.sdk.metadata_seed_failed'));
  metadataReady = { origin, ownsScope, promise };
}

export async function getModels(controls: RequestControls = {}): Promise<RoutstrModel[]> {
  // No provider, no catalog. A model list fetched from a node the user did not
  // pick would be a menu of things they cannot buy.
  if (!hasRoutstrProvider()) throw noProviderChosen();
  apiLog.info('api.routstr.models.start');
  const start = performance.now();
  const ownsScope = captureRequestScope();
  try {
    const response = await fetch(`${routstrBaseUrl()}/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: buildAbortSignal({ timeoutMs: ROUTSTR_TIMEOUT_MS, ...controls }),
    });
    const data = (await readRoutstrEnvelope(response, ModelsResponseSpine, {
      route: '/models',
      invalidShapeEvent: 'api.routstr.models.invalid_shape',
    })) as unknown as ModelsResponse;
    const enabled = data.data.filter((model) => model.enabled);
    apiLog.info('api.routstr.models.success', {
      count: enabled.length,
      duration_ms: Math.round((performance.now() - start) * 100) / 100,
    });
    // The SDK sizes every request's token from ITS cached pricing and picks
    // the paying mint from ITS accepted-mint list, so the catalog nagg's
    // lineup already fetched is handed over rather than discovered a second
    // time over Nostr. Without the pricing the SDK funds each request at one
    // sat; without the mint list it pays from whichever mint holds the most,
    // which this node then refuses.
    if (ownsScope()) await seedFromNode(routstrOrigin(), enabled as unknown as Model[], ownsScope);
    return enabled;
  } catch (error) {
    // Resolve lazily to avoid api → refresh → store → api initialisation cycles.
    const nodeError =
      error && typeof error === 'object' && 'status' in error
        ? error
        : { status: 0, error: { type: isAbortError(error) ? 'aborted' : 'network_error' } };
    if (ownsScope() && isRoutstrNodeFailure(nodeError)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Lazy cycle boundary, supported by Metro and Jest CJS.
      const refreshModule = require('./refreshLineup') as typeof import('./refreshLineup');
      await refreshModule.refreshRoutstrLineup('failure');
    }
    apiLog.error('api.routstr.models.failed', {
      status: error && typeof error === 'object' && 'status' in error ? error.status : 0,
      duration_ms: Math.round((performance.now() - start) * 100) / 100,
    });
    toRoutstrError(error);
  }
}

export async function checkBalance(
  apiKey: string,
  controls: RequestControls = {}
): Promise<BalanceResponse> {
  apiLog.debug('api.routstr.balance.start', { hasApiKey: !!apiKey, keyLength: apiKey?.length });
  const start = performance.now();
  const ownsScope = captureRequestScope();
  try {
    const response = await fetch(`${routstrBaseUrl()}/wallet/info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: buildAbortSignal({ timeoutMs: ROUTSTR_TIMEOUT_MS, ...controls }),
    });
    const balanceKey = applyResponseChange(response, apiKey, ownsScope);
    apiLog.debug('api.routstr.balance.response', {
      status: response.status,
      duration_ms: Math.round(performance.now() - start),
    });
    const data = await readRoutstrEnvelope(
      response,
      BalanceSpine,
      {
        route: '/wallet/info',
        invalidShapeEvent: 'api.routstr.balance.invalid_shape',
      },
      apiKey,
      balanceKey,
      ownsScope
    );
    const result = {
      balance: data.balance ?? 0,
      total_spent: data.total_spent ?? 0,
      api_key: data.api_key,
      reserved: data.reserved ?? 0,
    };
    apiLog.info('api.routstr.balance.success', {
      balance: result.balance,
      totalSpent: result.total_spent,
      reserved: result.reserved,
      hasServerKey: !!result.api_key,
      duration_ms: Math.round(performance.now() - start),
    });
    return result;
  } catch (error) {
    apiLog.error('api.routstr.balance.failed', {
      status: error && typeof error === 'object' && 'status' in error ? error.status : 0,
      duration_ms: Math.round(performance.now() - start),
    });
    toRoutstrError(error);
  }
}

export async function topUpBalance(
  { apiKey, cashuToken }: { apiKey: string; cashuToken: string },
  controls: RequestControls = {}
): Promise<TopUpResponse> {
  apiLog.info('api.routstr.wallet.topup.start', { tokenLength: cashuToken?.length });
  const start = performance.now();
  const ownsScope = captureRequestScope();
  try {
    const response = await fetch(`${routstrBaseUrl()}/wallet/topup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cashu_token: cashuToken }),
      signal: buildAbortSignal({ timeoutMs: ROUTSTR_TIMEOUT_MS, ...controls }),
    });
    const balanceKey = applyResponseChange(response, apiKey, ownsScope);
    apiLog.debug('api.routstr.wallet.topup.response', {
      status: response.status,
      duration_ms: Math.round(performance.now() - start),
    });
    const data = await readRoutstrEnvelope(
      response,
      TopUpSpine,
      {
        route: '/wallet/topup',
        invalidShapeEvent: 'api.routstr.wallet.topup.invalid_shape',
      },
      apiKey,
      balanceKey,
      ownsScope
    );
    const result = { added_amount: data.msats ?? 0 };
    apiLog.info('api.routstr.wallet.topup.success', {
      addedAmount: result.added_amount,
      duration_ms: Math.round(performance.now() - start),
    });
    return result;
  } catch (error) {
    apiLog.error('api.routstr.wallet.topup.failed', {
      status: error && typeof error === 'object' && 'status' in error ? error.status : 0,
      duration_ms: Math.round(performance.now() - start),
    });
    toRoutstrError(error);
  }
}

/**
 * What a `Response` that cannot carry a stream stores instead of the body —
 * `whatwg-fetch`'s final `_initBody` branch, `Object.prototype.toString`.
 */
const STRINGIFIED_STREAM = '[object ReadableStream]';

/**
 * Parse SSE stream manually for React Native compatibility.
 * Uses ReadableStream when available, falls back to full-text parsing.
 */
async function* parseSSEStream(
  response: Response,
  deadline: RequestDeadline
): AsyncGenerator<ChatCompletionChunk> {
  // Boolean, not the `&&` chain it came from: an `undefined` here is dropped
  // by the log serializer, and the missing key read as "not recorded" during
  // the investigation that produced `stringified_stream_body` below.
  const hasReadableStream = !!response.body && typeof response.body.getReader === 'function';
  apiLog.debug('routstr.sse.start', {
    hasReadableStream,
    contentType: response.headers.get('content-type'),
  });
  if (hasReadableStream) {
    yield* parseSSEFromReadableStream(response.body!, deadline);
    return;
  }

  apiLog.warn('routstr.sse.no_readable_stream', { fallback: 'full_text_parse' });
  const text = await deadline.wait(response.text());
  let chunks = 0;
  for (const chunk of parseSSEFromText(text)) {
    chunks++;
    yield chunk;
  }
  if (chunks === 0) {
    // A 200 that yields nothing is indistinguishable on screen from a hang,
    // and the causes need different fixes: an empty body, a body that is not
    // SSE at all, or a stream stringified by a `Response` that cannot hold one.
    // That last one is named outright rather than left as a byte count: it cost
    // a paid turn and a long investigation to recognise 23 characters as
    // `Object.prototype.toString.call(stream)`. `installStreamCapableResponse`
    // is what stops it; this fires if that shim is ever lost or bypassed.
    if (text === STRINGIFIED_STREAM) {
      apiLog.error('routstr.sse.stringified_stream_body', {
        contentType: response.headers.get('content-type'),
        fix: 'installStreamCapableResponse',
      });
    } else {
      // Bounded and shape-only — an SSE frame's payload is the user's own
      // prompt coming back.
      apiLog.error('routstr.sse.empty_text', {
        length: text.length,
        contentType: response.headers.get('content-type'),
      });
    }
  }
}

function tryParseSSELine(line: string): ChatCompletionChunk | 'done' | null {
  const trimmed = line.trim();
  // `data:` with no space is legal SSE and the routstr SDK's own parser accepts
  // it; requiring the space silently discarded every line of a well-formed
  // stream, which reads on screen as an answer that never arrived.
  if (!trimmed || !trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return 'done';
  if (!data) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    apiLog.warn('routstr.sse.parse_failed');
    return null;
  }
  const validated = ChatCompletionChunkSpine.safeParse(raw);
  if (!validated.success) {
    apiLog.warn('routstr.sse.invalid_shape', {
      issues: validated.error.issues.length,
    });
    return null;
  }
  return validated.data;
}

async function* parseSSEFromReadableStream(
  body: ReadableStream<Uint8Array>,
  deadline: RequestDeadline
): AsyncGenerator<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let chunkCount = 0;
  const streamStart = performance.now();

  try {
    while (true) {
      const { done, value } = await deadline.wait(reader.read());
      deadline.touch(RESPONSE_IDLE_DEADLINE_MS);

      if (done) {
        for (const line of buffer.split('\n')) {
          const result = tryParseSSELine(line);
          if (result === 'done') break;
          if (result) {
            chunkCount++;
            yield result;
          }
        }
        apiLog.info('routstr.sse.stream_end', {
          chunks: chunkCount,
          duration_ms: Math.round(performance.now() - streamStart),
        });
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const result = tryParseSSELine(line);
        if (result === 'done') {
          apiLog.info('routstr.sse.stream_end', {
            chunks: chunkCount,
            duration_ms: Math.round(performance.now() - streamStart),
          });
          return;
        }
        if (result) {
          chunkCount++;
          yield result;
        }
      }
    }
  } catch (error) {
    apiLog.error('routstr.sse.stream_error', {
      chunks: chunkCount,
      duration_ms: Math.round(performance.now() - streamStart),
      status: error && typeof error === 'object' && 'status' in error ? error.status : 0,
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function* parseSSEFromText(text: string): Generator<ChatCompletionChunk> {
  for (const line of text.split('\n')) {
    const result = tryParseSSELine(line);
    if (result === 'done') return;
    if (result) yield result;
  }
}

/**
 * OpenAI-compatible multimodal message content. Images travel INLINE as
 * base64 data-URLs in `image_url` parts — routstr-core decodes data-URLs
 * server-side; there is no separate upload endpoint. This is the single
 * wire contract for chat content: `sendMessage`, the send/retry assembly
 * in `useAiSend`, and every input-length log all consume these types so a
 * string-only assumption can't survive anywhere on the path.
 */
export type RoutstrContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

type RoutstrMessageContent = string | RoutstrContentPart[];

export interface RoutstrChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: RoutstrMessageContent;
}

/**
 * Input-size accounting that never serialises image payloads: text chars
 * are summed, image parts are counted. Exported for `useAiSend`'s request
 * logs — base64 in a log line would blow the log budget AND trip the
 * redaction scanner's large-blob heuristics.
 */
export function measureMessageContent(messages: RoutstrChatMessage[]): {
  textChars: number;
  imageParts: number;
} {
  let textChars = 0;
  let imageParts = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      textChars += m.content.length;
      continue;
    }
    for (const part of m.content) {
      if (part.type === 'text') textChars += part.text.length;
      else imageParts++;
    }
  }
  return { textChars, imageParts };
}

/**
 * One chat completion, paid per request out of the wallet.
 *
 * `paymentSats` must clear the node's admission gate, not the expected cost:
 * routstr refuses an under-funded token before it forwards anything. Whatever
 * the request does not consume comes back as change in the `X-Cashu` response
 * header — including on refusals — and goes straight into the wallet. Nothing
 * is held on the node between requests, which is what stops a node change from
 * stranding a balance.
 */
/**
 * Give an SDK failure back its status and its words.
 *
 * `@routstr/sdk` throws typed errors that carry the upstream status, the
 * provider and the request id — and then this app used to flatten every one of
 * them into `status: 0, type: network_error`, which is why a provider refusing
 * a model reads on screen as "Failed to send message". Translating them keeps
 * the candidate walk working (it advances on a 402 that is not a wallet
 * shortfall) and lets the error catalog say something true.
 *
 * Returns `null` for anything unrecognised, which `toRoutstrError` then handles
 * as the transport failure it probably is.
 */
function fromSdkError(
  error: unknown,
  /** What the node actually answered, from the SDK's own log of it. */
  refusal: SdkRefusal | null = null,
  /** Whether the whole token came back with that answer. */
  refunded: boolean | undefined = undefined
): RoutstrError | null {
  // The wallet could not fund the gate. Said in the node's own vocabulary so
  // the send path treats it as a balance problem — which it is — instead of a
  // transport failure it would pointlessly fail over. The node speaks in
  // millisats, so these must too or the 402 balance sync is out by 1000x.
  if (error instanceof InsufficientBalanceError) {
    return {
      status: 402,
      error: {
        message: error.message,
        code: 'insufficient_balance',
        type: 'insufficient_quota',
        details: { required: error.required * 1000, available: error.available * 1000 },
      },
    };
  }
  // The mint refused the swap — usually its fees against a token too small to
  // survive them. A provider change will not help; a mint change will.
  if (error instanceof MintError) {
    return {
      status: error.statusCode || 422,
      error: {
        message: error.message,
        code: error.code ?? 'mint_error',
        type: 'mint_error',
        details: undefined,
      },
    };
  }
  if (error instanceof MintUnreachableError) {
    return {
      status: 0,
      error: { message: error.message, code: 'mint_unreachable', type: 'mint_error' },
    };
  }
  // The node answered, and badly. `statusCode` is the upstream's own status,
  // which is the difference between "this model is out of credit" and "this
  // node is down" — a distinction the whole candidate walk is built on.
  if (error instanceof ProviderError) {
    // `statusCode` is -1 for a transport failure the SDK routed through its
    // error path — the request died before any status, and the SDK then
    // failed to reclaim the token because the node had already redeemed it
    // ("[xcashu] Failed to receive refund token"). That is not the provider
    // answering badly; it is the connection dropping while the node was
    // still working, with the sats parked in the node's refund row until the
    // sweep collects them. Said as that, so the copy can be honest about
    // where the money is.
    if (error.statusCode <= 0) {
      const changePending = /refund token/i.test(error.message);
      return {
        status: 0,
        error: {
          message: error.message,
          code: changePending ? 'change_pending' : 'network_error',
          type: 'network_error',
          details: refunded != null ? { refunded } : undefined,
        },
      };
    }
    return {
      status: error.statusCode,
      error: {
        message: error.message,
        code: 'provider_error',
        type: 'provider_error',
        details: refunded != null ? { refunded } : undefined,
      },
    };
  }
  // The node redeemed — or tried to redeem — the token and said what went
  // wrong with it. The SDK types these four from the node's own `type`/`code`
  // (`routstr/wallet.py` `classify_redemption_error`) and then, when its
  // provider walk is one node long, re-throws them untyped through
  // `FailoverError` — except `CoreInternalError`, which it throws directly
  // and which this app used to read as `status: 0, network_error`: a 500 from
  // a node's wallet reported as "the provider is unreachable". The statuses
  // here are the ones the node sent. Every one of them is about the payment,
  // not the model, which the send path reads through `isPaymentLayerFailure`.
  if (error instanceof CoreInternalError) {
    return {
      status: 500,
      error: { message: error.message, code: 'internal_error', type: 'api_error' },
    };
  }
  if (error instanceof TokenConsumedError) {
    return {
      status: 500,
      error: { message: error.message, code: 'cashu_token_consumed', type: 'token_consumed' },
    };
  }
  if (error instanceof TokenAlreadySpentError) {
    return {
      status: 400,
      error: {
        message: error.message,
        code: 'cashu_token_already_spent',
        type: 'token_already_spent',
      },
    };
  }
  if (error instanceof InvalidTokenError) {
    return {
      status: 400,
      error: { message: error.message, code: 'invalid_cashu_token', type: 'invalid_token' },
    };
  }
  if (error instanceof CashuRedemptionError) {
    return {
      status: 400,
      error: {
        message: error.message,
        code: 'cashu_token_redemption_failed',
        type: 'cashu_error',
      },
    };
  }
  // A `FailoverError` says the SDK's provider walk ended. Sovran pins the one
  // provider the user chose and never switches on their behalf (see
  // `hasRoutstrProvider`), so that walk is one node long and "all providers
  // failed" is a claim about a population of one. Reporting it as
  // `no_providers` sent a real 404 from a chosen node out as advice about
  // provider availability, and cost a long investigation to see through.
  //
  // The error carries no status, no body and no request id — the SDK reads
  // the response, logs it, and throws this. So the answer the node actually
  // gave is put back from that log (`SdkRefusal`): its status, its `type`,
  // its `code`, its sentence. Without it every refusal was a 502
  // `provider_refused`, and the walk — which stops on 5xx — never learned
  // that a 404 from one model's upstream is not a broken node.
  if (error instanceof FailoverError) {
    const tried = error.failedProviders?.length ?? 0;
    if (tried <= 1) {
      if (refusal) {
        return {
          status: refusal.status,
          error: {
            message: refusal.message ?? error.message,
            code: refusal.code != null ? String(refusal.code) : 'provider_refused',
            type: refusal.type ?? 'provider_error',
            details: refunded != null ? { refunded } : undefined,
          },
        };
      }
      return {
        status: 502,
        error: {
          message: error.message,
          code: 'provider_refused',
          type: 'provider_error',
          details: refunded != null ? { refunded } : undefined,
        },
      };
    }
  }
  if (error instanceof NoProvidersAvailableError || error instanceof FailoverError) {
    return {
      status: 503,
      error: { message: error.message, code: 'no_providers', type: 'provider_error' },
    };
  }
  // The wallet could not mint the token, and said so in a plain `Error` the
  // SDK re-threw untyped. Left unclassified it became `status: 0,
  // network_error` — which the catalogue reads as "the AI provider is
  // unreachable". On 2026-09-25 that sent a user through dozens of providers
  // while `mint.minibits.cash/Bitcoin/v1/info` answered 502 to every one of
  // them; the log's only trace was `createProviderToken: … failed: Failed to
  // fetch mint …` from the SDK, arriving after the app had already blamed the
  // node. No provider change can fix a mint, so this has to say "mint".
  if (isMintFailureMessage(error)) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 0,
      error: { message, code: 'mint_unreachable', type: 'mint_error', details: undefined },
    };
  }
  return null;
}

/**
 * Whether a plain error is the wallet failing to reach or use a mint.
 *
 * Matched on the message because that is all there is: `@cashu/coco-core`
 * throws `Failed to fetch mint <url>` and `@routstr/sdk` wraps a mint network
 * failure as `Your mint <url> is unreachable or is blocking your IP`, neither
 * of which crosses the SDK boundary as a typed `MintUnreachableError`.
 */
function isMintFailureMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return false;
  return (
    /failed to fetch mint/i.test(message) ||
    /unreachable or is blocking your ip/i.test(message) ||
    /all candidate mints/i.test(message) ||
    /mint .*(is )?unreachable/i.test(message)
  );
}

/**
 * A `routeRequest` response, with what the SDK attaches to it.
 *
 * The SDK's own typings return a plain `Response`; these three properties are
 * added at runtime and are the whole reason to route through it — `finalize`
 * banks the change and resolves to what the node actually took.
 */
interface RoutedResponse extends Response {
  satsSpent?: number;
  requestId?: string;
  finalize?: () => Promise<number>;
}

/**
 * Send one chat turn, paid per request out of the wallet.
 *
 * Transport, payment and E2EE are `@routstr/sdk`'s: it prices the request the
 * way the node's admission gate does, mints a token for that amount through the
 * Coco wallet adapter, seals the body for a Tinfoil model, redeems the change
 * from the `X-Cashu` response header, and records the token in between so an
 * app that dies mid-request can still chase the money.
 *
 * What stays here is Sovran's: which node, which mint, this app's error
 * classification, and the annotation that ties both money legs to the message
 * they bought.
 *
 * `cost` resolves after the stream ends, because that is when the exact figure
 * exists — spent minus returned. It settles whether or not the caller consumes
 * the stream, so the change never depends on the UI finishing.
 */
/**
 * The exact JSON body one chat completion goes out as.
 *
 * Spelled once because two things have to agree on it to the character: the
 * request `sendMessage` dispatches, and the reservation
 * `features/ai/lib/reserve.ts` quotes the user before it does. The SDK sizes
 * the ecash token from the body it is handed — including a raw
 * `sumStringChars` walk over it — so a body the pricing path did not see is a
 * figure the user was shown that is not the one that leaves their wallet.
 * That gap is what this export closes.
 */
export function routstrChatRequestBody(options: {
  model: string;
  messages: readonly RoutstrChatMessage[];
  temperature?: number;
  max_tokens?: number;
}): Record<string, unknown> {
  const { model, messages, temperature, max_tokens } = options;
  return {
    model,
    messages,
    ...(temperature != null && { temperature }),
    ...(max_tokens != null && { max_tokens }),
    stream: true,
  };
}

export async function sendMessage(
  messages: RoutstrChatMessage[],
  options: {
    model: string;
    /** What this request is buying, so both money legs can point at it. */
    payment?: PaymentContext;
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  }
): Promise<{ stream: AsyncIterable<ChatCompletionChunk>; cost: Promise<number> }> {
  // No default. A sampling temperature is a claim about what the model
  // accepts, and nothing in the catalogue supports one — `RoutstrModel`
  // carries `max_completion_tokens` and no temperature capability at all.
  // Both reference clients (routstr-chat, the SDK's own fetch path) send the
  // field only when a caller asks for it, and a reasoning model rejects a
  // non-default value outright. A destructuring default would fire on
  // `undefined` and put it back on the wire, which is why the caller cannot
  // drop it alone.
  const { model, payment: context, temperature, max_tokens } = options;
  const { textChars, imageParts } = measureMessageContent(messages);
  // `useAiSend` passes its `flowId` as the payment group id, so every line
  // below joins the `ai.send.*` timeline the UI already writes rather than
  // starting a second one the reader has to correlate by timestamp.
  const flowId = context?.groupId;
  const nodeHost = hostOf(hasRoutstrProvider() ? routstrOrigin() : undefined);
  apiLog.info('api.routstr.chat.start', {
    flowId,
    nodeHost,
    model,
    upstreamId: upstreamIdForModel(model),
    messageCount: messages.length,
    totalInputChars: textChars,
    imageParts,
    temperature,
    max_tokens,
  });
  const start = performance.now();
  const ownsScope = captureRequestScope();
  if (!hasRoutstrProvider()) throw noProviderChosen();
  const origin = routstrOrigin();
  const deadline = createRequestDeadline(options.signal);
  const signal = deadline.signal;
  let mintUrl: string | undefined;
  let response: RoutedResponse;
  let finishPayment = async () => {};
  let bound: Awaited<ReturnType<typeof getRoutstrClient>> | undefined;
  // How far this attempt got, in the order it gets there. Reported on every
  // failure so "it never reached the ecash part" is one field rather than an
  // inference from which events are missing.
  let phase: 'mint_selection' | 'client' | 'payment' | 'headers' | 'stream' = 'mint_selection';
  const elapsed = () => Math.round(performance.now() - start);
  try {
    const paying = await deadline.wait(payingMintUrl(origin));
    mintUrl = paying.mintUrl;
    phase = 'client';
    apiLog.info('api.routstr.chat.mint_selected', {
      flowId,
      nodeHost,
      mintHost: hostOf(paying.mintUrl),
      matchedSelection: paying.matchedSelection,
      acceptedMints: paying.acceptedMints,
      walletMints: paying.walletMints,
      duration_ms: elapsed(),
    });
    const client = await deadline.wait(
      getRoutstrClient(origin, () => ownsScope() && !signal.aborted)
    );
    bound = client;
    finishPayment = client.finish;
    if (!ownsScope() || signal?.aborted) throw new Error('Request cancelled before payment');
    const payingMint = mintUrl;
    phase = 'payment';
    // Everything local is done; from here the SDK prices the request, mints a
    // token for it and dispatches. `routstr.sdk.sent` is the next marker, and
    // its absence after this line is the whole "never reached ecash" class.
    apiLog.info('api.routstr.chat.dispatch', {
      flowId,
      nodeHost,
      mintHost: hostOf(payingMint),
      model,
      upstreamId: upstreamIdForModel(model),
      temperature,
      max_tokens,
      duration_ms: elapsed(),
    });
    response = (await deadline.wait(
      withPaymentScope(context, () =>
        client.client.routeRequest({
          path: '/v1/chat/completions',
          method: 'POST',
          baseUrl: client.baseUrl,
          mintUrl: payingMint,
          // The catalog id, not the upstream one: the SDK maps a `tinfoil-`
          // model to its enclave name and carries the catalog id separately in
          // `X-Routstr-Model`, which is what the node bills and routes on when
          // it can no longer read the body.
          modelId: model,
          // One spelling of the wire shape, shared with the reservation quote
          // the user approved — see `routstrChatRequestBody`.
          body: routstrChatRequestBody({ model, messages, temperature, max_tokens }),
          signal,
        })
      )
    )) as RoutedResponse;
    deadline.touch(RESPONSE_IDLE_DEADLINE_MS);
  } catch (error) {
    deadline.dispose();
    const paid = bound?.payment();
    const refusal = bound?.refusal() ?? null;
    // Refunded means the whole token came home with the refusal — the node's
    // way of saying the request, not the payment, was the problem.
    const refunded =
      paid?.mintedSats != null
        ? paid.changeReceived && paid.changeSats != null && paid.changeSats >= paid.mintedSats
        : undefined;
    const translated = fromSdkError(error, refusal, refunded);
    const raw = error instanceof Error ? error : undefined;
    apiLog.error('api.routstr.chat.failed', {
      flowId,
      nodeHost,
      // The node's software version, when the directory knows it. Two of the
      // eight failures on 2026-09-26 were the two nodes older than v0.4.5,
      // and it took a `/v1/info` per node by hand to see that.
      nodeVersion: routstrStoreState().knownProviders[origin]?.version,
      mintHost: paid?.mintedFromHost ?? hostOf(mintUrl),
      model,
      upstreamId: upstreamIdForModel(model),
      phase,
      // What the node said, as opposed to what the SDK threw. `upstreamStatus`
      // is the status the node returned; `upstreamType`/`upstreamCode` are
      // its own classification of why — `upstream_error` + the upstream's
      // status for a model its upstream would not serve, a payment-layer type
      // for a token it could not use.
      upstreamStatus: refusal?.status,
      upstreamType: refusal?.type,
      upstreamCode: refusal?.code,
      refunded,
      // The three questions a failed attempt has to answer before anyone can
      // act on it: did the token ever get minted, did the change come home,
      // and was it us or the node that gave up.
      tokenMinted: paid?.mintedSats != null,
      mintedSats: paid?.mintedSats ?? undefined,
      changeSats: paid?.changeSats ?? undefined,
      changeReceived: paid?.changeReceived,
      changeFailed: paid?.changeFailed,
      timedOut: signal.aborted && raw?.name === 'TimeoutError',
      cancelled: signal.aborted && raw?.name !== 'TimeoutError',
      status: translated?.status ?? 0,
      code: translated?.error.code,
      errorName: raw?.name,
      // The untranslated text, which is the only place a mint outage, an
      // Expo fetch failure and a node refusal look different from each other.
      reason: (translated?.error.message ?? raw?.message ?? String(error)).slice(0, 200),
      duration_ms: elapsed(),
    });
    // Anything still in flight is money the node may or may not have taken;
    // only the node can say, and the sweep is how it is asked. A token the
    // node redeemed but never returned change for is the case that costs
    // real sats — the connection dropped while the node was still generating
    // — and the node writes its refund row only when that work ends, so the
    // asking is spread over the next minutes rather than done once now.
    if (ownsScope() && paid?.mintedSats != null && !paid.changeReceived) {
      scheduleRecoverySweeps();
    } else if (ownsScope() && !translated) {
      void sweepUnsettledPayments('failure');
    }
    if (translated) throw translated;
    toRoutstrError(error);
  }

  phase = 'headers';
  const requestId = response.headers.get('x-routstr-request-id') || response.requestId || undefined;
  const paidFor = bound?.payment();
  // Promoted from `debug`: this is the line that separates "the node never
  // answered" from "the node answered and refused", and the debug lane is off
  // in the builds where that question gets asked.
  apiLog.info('api.routstr.chat.response_received', {
    flowId,
    nodeHost,
    status: response.status,
    requestId,
    contentType: response.headers.get('content-type') ?? undefined,
    // The node returns change in this header. Its absence on a refusal means
    // the sats are still on the node and only the refund endpoint can get
    // them back.
    hasChangeHeader: response.headers.get('x-cashu') != null,
    mintedSats: paidFor?.mintedSats ?? undefined,
    ttfb_ms: elapsed(),
  });

  if (!response.ok) {
    // The change, if the node returned any, is already home: a non-streaming
    // response is finalized inside `routeRequest` before it comes back.
    try {
      await deadline.wait(throwResponseError(response, undefined, undefined, ownsScope));
    } catch (error) {
      deadline.dispose();
      const refused = bound?.payment();
      apiLog.error('api.routstr.chat.failed', {
        flowId,
        nodeHost,
        model,
        upstreamId: upstreamIdForModel(model),
        phase,
        status: response.status,
        requestId,
        tokenMinted: refused?.mintedSats != null,
        mintedSats: refused?.mintedSats ?? undefined,
        changeSats: refused?.changeSats ?? undefined,
        changeReceived: refused?.changeReceived,
        changeFailed: refused?.changeFailed,
        reason:
          error && typeof error === 'object' && 'error' in error
            ? String((error as RoutstrError).error.message).slice(0, 200)
            : undefined,
        duration_ms: elapsed(),
      });
      if (ownsScope() && isModelRejectedError(error, model))
        routstrStoreState().invalidateServerLineup();
      throw error;
    }
  }

  phase = 'stream';
  apiLog.info('api.routstr.chat.stream_started', {
    flowId,
    nodeHost,
    model,
    requestId,
    ttfb_ms: elapsed(),
  });

  // Started here rather than awaited: the SDK banks the change as soon as the
  // stream ends, and reading the figure must not hold up the first chunk.
  let pendingCompletions = 2;
  const completed = () => {
    pendingCompletions -= 1;
    if (pendingCompletions === 0) deadline.dispose();
  };
  const cost = deadline
    .wait(
      (async () => {
        const sats = response.finalize
          ? await withPaymentScope(context, () => response.finalize!())
          : (response.satsSpent ?? 0);
        const settled = bound?.payment();
        // No change came back. Either there was none — the node consumed the
        // whole token, which its cost header confirms — or the node failed to
        // mint it, in which case the token stays journalled for the sweep.
        // The SDK cannot tell these apart and keeps the token either way, so
        // the sweep chased fully-spent 1-sat tokens with 425s for days.
        const changeHeader = response.headers.get('x-cashu') != null;
        const costMsats = Number(response.headers.get('x-routstr-cost-msats'));
        let consumedInFull: boolean | undefined;
        if (!changeHeader && settled?.mintedSats != null && bound) {
          consumedInFull =
            Number.isFinite(costMsats) &&
            costMsats > 0 &&
            Math.ceil(costMsats / 1000) >= settled.mintedSats;
          if (consumedInFull) bound.settleWithoutChange();
          else if (settled.changeSats == null) {
            apiLog.warn('routstr.payment.change_missing', {
              flowId,
              nodeHost,
              model,
              mintedSats: settled.mintedSats,
              costMsats: Number.isFinite(costMsats) ? costMsats : undefined,
            });
          }
        }
        await finishPayment();
        apiLog.info('routstr.payment.settled', {
          flowId,
          nodeHost,
          model,
          costSats: sats,
          mintedSats: settled?.mintedSats ?? undefined,
          changeSats: settled?.changeSats ?? undefined,
          consumedInFull,
          duration_ms: elapsed(),
        });
        return sats;
      })()
    )
    .finally(completed);
  // A stream error can make the caller exit before awaiting its cost.
  // Keep the rejection observable to awaiters without an unhandled promise.
  void cost.catch(() => {});

  const stream = (async function* () {
    try {
      yield* parseSSEStream(response, deadline);
    } finally {
      completed();
    }
  })();
  return { stream, cost };
}
