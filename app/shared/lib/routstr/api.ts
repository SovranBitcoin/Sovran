import { z } from 'zod';
import { apiLog } from '../logger';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { isAbortError, type RequestControls } from 'wallet/safeFetch';

const ROUTSTR_DEFAULT_BASE_URL = 'https://api.routstr.com/v1';

/**
 * Node override served by nagg's `/app/ai-lineup` (and re-applied from the
 * persisted `routstrStore.nodeBaseUrl` on hydrate). Lets a nagg deploy
 * repoint already-shipped builds at a different Routstr node if the default
 * one dies — the strongest OTA lever the lineup endpoint carries. Module
 * state rather than a store read so this shared lib never imports a store.
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
    details?: {
      required?: number;
      available?: number;
      retry_after?: number;
    };
  };
}

interface ParsedErrorData {
  message: string;
  type: string;
  details?: Record<string, unknown>;
  error?: { message?: string };
}

// ── Error Handling ───────────────────────────────────────────────────────

async function parseErrorResponse(response: Response): Promise<ParsedErrorData> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const message = await extractErrorMessageFromHTML(response);
    return {
      message,
      type: response.status >= 500 ? 'server_error' : 'client_error',
    };
  }

  try {
    const raw = await response.json();
    // Normalize: server may return {"error": {...}} (OpenAI format)
    // or {"detail": "..."} (FastAPI format). Flatten into ParsedErrorData.
    if (raw.error && typeof raw.error === 'object') {
      let details = raw.error.details;
      // Extract required/available from "Insufficient balance: X mSats required ... Y available."
      if (!details && raw.error.message && typeof raw.error.message === 'string') {
        const match = raw.error.message.match(/(\d+)\s*mSats?\s*required.*?(\d+)\s*available/i);
        if (match) {
          details = { required: parseInt(match[1], 10), available: parseInt(match[2], 10) };
        }
      }
      return {
        message: raw.error.message || raw.detail || '',
        type: raw.error.type || raw.error.code || 'unknown_error',
        details,
        error: raw.error,
      };
    }
    return {
      message: raw.detail || raw.message || '',
      type: raw.type || 'unknown_error',
      details: raw.details,
      error: raw.error,
    };
  } catch {
    return {
      message: response.statusText || `HTTP ${response.status}`,
      type: 'unknown_error',
    };
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

const FRIENDLY_MESSAGES: Record<number, string> = {
  401: 'Authentication failed. Please check your API key.',
  402: 'Insufficient balance. Please top up your account.',
  429: 'Rate limit exceeded. Please wait a moment before trying again.',
  502: 'Service temporarily unavailable. Please try again in a few minutes.',
  503: 'Service temporarily unavailable. Please try again in a few minutes.',
  504: 'Request timeout. The service is taking too long to respond.',
};

function getUserFriendlyErrorMessage(status: number, errorData: ParsedErrorData): string {
  if (status === 402 && errorData.error?.message) return errorData.error.message;
  return (
    FRIENDLY_MESSAGES[status] ||
    errorData.error?.message ||
    errorData.message ||
    `HTTP ${status} error`
  );
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

/**
 * Throw a typed RoutstrError from a failed fetch Response.
 * Shared by all API functions to avoid duplicating the parse → format → throw chain.
 */
async function throwResponseError(response: Response): Promise<never> {
  const errorData = await parseErrorResponse(response);
  const status = response.status;
  apiLog.warn('api.routstr.http_error', {
    status,
    type: errorData.type,
    message: errorData.message,
    details: errorData.details,
  });

  // 401 with expired/spent key — clear stored API key so user can re-authenticate
  if (status === 401) {
    apiLog.warn('api.routstr.api_key_expired');
    routstrStoreState().clearApiKey();
    routstrStoreState().clearBalance();
  }

  // 402 carries the server's true available balance ("X mSats required …
  // Y available") — sync it into the store. The local balance otherwise
  // only refreshes after a SUCCESSFUL stream, so a drained (or
  // reservation-held) key leaves the UI gating sends against a stale
  // figure forever: every affordability check passes client-side, every
  // send 402s, and the insufficient-balance popup loops. Syncing here
  // makes the balance pill, picker fades, and estimates truthful the
  // moment the server disagrees.
  if (status === 402) {
    const available = errorData.details?.available;
    if (typeof available === 'number' && isFinite(available) && available >= 0) {
      apiLog.info('api.routstr.balance_synced_from_402', { availableMsats: available });
      routstrStoreState().setBalance(available);
    }
  }

  throw {
    status,
    error: {
      message: getUserFriendlyErrorMessage(status, errorData),
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
  meta: { route: string; invalidShapeEvent: string }
): Promise<z.infer<TSpine>> {
  if (!response.ok) await throwResponseError(response);

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
    apiLog.error('api.routstr.models.failed', {
      error,
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
  try {
    const response = await fetch(`${routstrBaseUrl()}/wallet/info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: buildAbortSignal({ timeoutMs: ROUTSTR_TIMEOUT_MS, ...controls }),
    });
    apiLog.debug('api.routstr.balance.response', {
      status: response.status,
      duration_ms: Math.round(performance.now() - start),
    });
    const data = await readRoutstrEnvelope(response, BalanceSpine, {
      route: '/wallet/info',
      invalidShapeEvent: 'api.routstr.balance.invalid_shape',
    });
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
      error,
      duration_ms: Math.round(performance.now() - start),
    });
    toRoutstrError(error);
  }
}

export async function topUpBalance(
  apiKey: string,
  cashuToken: string,
  controls: RequestControls = {}
): Promise<TopUpResponse> {
  apiLog.info('api.routstr.wallet.topup.start', { tokenLength: cashuToken?.length });
  const start = performance.now();
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
    apiLog.debug('api.routstr.wallet.topup.response', {
      status: response.status,
      duration_ms: Math.round(performance.now() - start),
    });
    const data = await readRoutstrEnvelope(response, TopUpSpine, {
      route: '/wallet/topup',
      invalidShapeEvent: 'api.routstr.wallet.topup.invalid_shape',
    });
    const result = { added_amount: data.msats ?? 0 };
    apiLog.info('api.routstr.wallet.topup.success', {
      addedAmount: result.added_amount,
      duration_ms: Math.round(performance.now() - start),
    });
    return result;
  } catch (error) {
    apiLog.error('api.routstr.wallet.topup.failed', {
      error,
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
    apiLog.warn('routstr.sse.parse_failed', { preview: data.substring(0, 100) });
    return null;
  }
  const validated = ChatCompletionChunkSpine.safeParse(raw);
  if (!validated.success) {
    apiLog.warn('routstr.sse.invalid_shape', {
      issues: validated.error.issues.length,
      preview: data.substring(0, 100),
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
      error,
    });
    throw new Error(
      'Failed to stream response: ' + (error instanceof Error ? error.message : String(error))
    );
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

export async function sendMessage(
  apiKey: string,
  messages: RoutstrChatMessage[],
  options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  } = {}
): Promise<{ stream: AsyncIterable<ChatCompletionChunk> }> {
  const { model = 'gpt-3.5-turbo', temperature = 0.7, max_tokens, signal } = options;
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

  try {
    const response = await fetch(`${routstrBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(max_tokens != null && { max_tokens }),
        stream: true,
      }),
      signal,
    });
    const requestId = response.headers.get('x-routstr-request-id') || undefined;
    apiLog.debug('api.routstr.chat.response_received', {
      status: response.status,
      requestId,
      duration_ms: Math.round(performance.now() - start),
    });
    if (!response.ok) await throwResponseError(response);

    apiLog.info('api.routstr.chat.stream_started', {
      model,
      requestId,
      ttfb_ms: Math.round(performance.now() - start),
    });
    return { stream: parseSSEStream(response) };
  } catch (error: unknown) {
    apiLog.error('api.routstr.chat.failed', {
      model,
      error,
      duration_ms: Math.round(performance.now() - start),
    });
    toRoutstrError(error);
  }
}
