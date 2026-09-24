import { z } from 'zod';

import { attestEnclave, invalidateAttestation } from './e2ee/attestation';
import {
  isKeyConfigMismatch,
  isSealedResponse,
  openResponse,
  sealRequest,
  type SealedRequest,
} from './e2ee/ehbpTransport';
import { isTinfoilModel, tinfoilUpstreamModelId } from './e2ee/tinfoilModels';
import { mintRequestPayment, receiveChange, reclaimUnspentPayment } from './payment';
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

/** Set (or clear with null) the Routstr node base URL, e.g.
 *  "https://api.routstr.com". The `/v1` path segment is appended here so the
 *  server payload stays a plain origin. */
export function setRoutstrNodeBaseUrl(url: string | null): void {
  const trimmed = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  routstrBaseUrlOverride = trimmed ? `${trimmed}/v1` : null;
}

function routstrBaseUrl(): string {
  return routstrBaseUrlOverride ?? ROUTSTR_DEFAULT_BASE_URL;
}

/**
 * `max_tokens` sent with every chat completion, and the completion-side
 * token count the affordability gate prices in (`format.ts`). Routstr
 * admits a request only when the balance covers its DISCOUNTED max cost:
 * the prompt side auto-discounts to the actual prompt size, but the
 * completion side only discounts when the request carries `max_tokens` —
 * without it the node reserves the model's ENTIRE `max_completion_cost`
 * (~1,500 sats for a frontier model), which is what produced "insufficient
 * balance" 402s against balances that covered the real turn cost many
 * times over. 4096 tokens is ample for chat answers while keeping the
 * upfront reservation ~30× smaller.
 */
export const ROUTSTR_MAX_COMPLETION_TOKENS = 4096;

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

export async function getModels(controls: RequestControls = {}): Promise<RoutstrModel[]> {
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
 * Parse SSE stream manually for React Native compatibility.
 * Uses ReadableStream when available, falls back to full-text parsing.
 */
async function* parseSSEStream(response: Response): AsyncGenerator<ChatCompletionChunk> {
  const hasReadableStream = response.body && typeof response.body.getReader === 'function';
  apiLog.debug('routstr.sse.start', {
    hasReadableStream,
    contentType: response.headers.get('content-type'),
  });
  if (hasReadableStream) {
    yield* parseSSEFromReadableStream(response.body!);
    return;
  }

  apiLog.warn('routstr.sse.no_readable_stream', { fallback: 'full_text_parse' });
  yield* parseSSEFromText(await response.text());
}

function tryParseSSELine(line: string): ChatCompletionChunk | 'done' | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;
  const data = trimmed.slice(6).trim();
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
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let chunkCount = 0;
  const streamStart = performance.now();

  try {
    while (true) {
      const { done, value } = await reader.read();

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
export async function sendMessage(
  messages: RoutstrChatMessage[],
  options: {
    model: string;
    paymentSats: number;
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  }
): Promise<{ stream: AsyncIterable<ChatCompletionChunk>; costSats: number }> {
  const { model, paymentSats, temperature = 0.7, max_tokens, signal } = options;
  const { textChars, imageParts } = measureMessageContent(messages);
  apiLog.info('api.routstr.chat.start', {
    model,
    messageCount: messages.length,
    totalInputChars: textChars,
    imageParts,
    temperature,
    max_tokens,
  });
  const start = performance.now();
  const ownsScope = captureRequestScope();
  const sealedTransport = isTinfoilModel(model);

  const payment = await mintRequestPayment(paymentSats, routstrBaseUrl());
  let settled = false;
  // Spent minus returned is what the node actually took. Exact, local, and
  // known before the first chunk — the change header is set before the body
  // streams. It replaces a balance diff that a concurrent write could corrupt
  // and that a node change made meaningless.
  let costSats = paymentSats;

  try {
    const authHeaders: Record<string, string> = { 'X-Cashu': payment.encoded };

    // The enclave is told the bare model id; the node is told the catalog's
    // prefixed one, out of band in `X-Routstr-Model`, because that is what it
    // bills and routes on and it can no longer read the body.
    const payload = {
      model: sealedTransport ? tinfoilUpstreamModelId(model) : model,
      messages,
      temperature,
      ...(max_tokens != null && { max_tokens }),
      stream: true,
    };

    const build = async (): Promise<{ init: RequestInit; sealed: SealedRequest | null }> => {
      if (!sealedTransport) {
        return {
          sealed: null,
          init: {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
          },
        };
      }
      const { hpkePublicKey } = await attestEnclave({ signal });
      const sealed = await sealRequest(hpkePublicKey, payload);
      return {
        sealed,
        init: {
          method: 'POST',
          headers: {
            ...authHeaders,
            ...sealed.headers,
            'X-Routstr-Model': model,
            'Content-Type': 'application/octet-stream',
          },
          body: sealed.body,
          signal,
        },
      };
    };

    // One send, plus at most one resend when the enclave rejects our key
    // configuration (422 problem+json) — that means it rotated under us, so
    // re-attesting and resending is the recovery. A second mismatch is a real
    // failure, not a race. Built as a loop so there is a single `fetch` site.
    let sealed: SealedRequest | null = null;
    let response: Response;
    for (let resends = 0; ; resends++) {
      const built = await build();
      sealed = built.sealed;
      response = await fetch(`${routstrBaseUrl()}/chat/completions`, built.init);
      if (resends > 0 || !sealed || !isKeyConfigMismatch(response)) break;
      apiLog.warn('routstr.e2ee.key_rotated', { model });
      invalidateAttestation();
    }

    // Change comes back on refusals too, so this runs before the status is
    // even looked at. `ownsScope` is logged rather than enforced: a profile
    // switch mid-request would send it to the wrong wallet, but dropping a
    // bearer token burns it outright, and the send is aborted on that switch
    // anyway.
    const change = response.headers.get('x-cashu');
    if (change) {
      settled = true;
      if (!ownsScope()) apiLog.warn('routstr.payment.change_out_of_scope');
      costSats = Math.max(0, paymentSats - (await receiveChange(change)));
      // The change is home, so there is nothing left to recover for this one.
      routstrStoreState().settlePayment(payment.id);
    }
    const requestId = response.headers.get('x-routstr-request-id') || undefined;
    apiLog.debug('api.routstr.chat.response_received', {
      status: response.status,
      requestId,
      sealed: sealedTransport,
      duration_ms: Math.round(performance.now() - start),
    });
    // Error responses reach us in PLAINTEXT: the node produces them before the
    // request ever gets to the enclave, so they carry no response nonce.
    // Decrypting unconditionally would throw and destroy the real status and
    // body — the 402/401 handling below depends on reading them intact.
    if (!response.ok) await throwResponseError(response, undefined, undefined, ownsScope);

    const decrypted =
      sealed && isSealedResponse(response)
        ? await openResponse(response, sealed.context)
        : response;

    settled = true;
    apiLog.info('api.routstr.chat.stream_started', {
      model,
      requestId,
      sealed: sealedTransport,
      ttfb_ms: Math.round(performance.now() - start),
    });
    apiLog.info('routstr.payment.settled', { model, paymentSats, costSats });
    return { stream: parseSSEStream(decrypted), costSats };
  } catch (error: unknown) {
    // No change header and no stream means the node never took the money —
    // a transport failure, or a refusal before redemption. Put it back. If it
    // DID redeem, the proofs are spent and this is a no-op by construction.
    if (!settled) await reclaimUnspentPayment(payment);
    apiLog.error('api.routstr.chat.failed', {
      model,
      status: error && typeof error === 'object' && 'status' in error ? error.status : 0,
      duration_ms: Math.round(performance.now() - start),
    });
    if (ownsScope() && isModelRejectedError(error, model))
      routstrStoreState().invalidateServerLineup();
    toRoutstrError(error);
  }
}
