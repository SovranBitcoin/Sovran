import OpenAI from 'openai';
import { apiLog } from '../logger';

const ROUTSTR_BASE_URL = 'https://api.routstr.com/v1';

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
 * Throw a typed RoutstrError from a failed fetch Response.
 * Shared by all API functions to avoid duplicating the parse → format → throw chain.
 */
async function throwResponseError(response: Response): Promise<never> {
  const errorData = await parseErrorResponse(response);
  const status = response.status;
  apiLog.warn('api.routstr.http_error', { status, type: errorData.type, message: errorData.message, details: errorData.details });

  // 401 with expired/spent key — clear stored API key so user can re-authenticate
  if (status === 401) {
    const { useRoutstrStore } = await import('@/shared/stores/profile/routstrStore');
    apiLog.warn('api.routstr.api_key_expired');
    useRoutstrStore.getState().clearApiKey();
    useRoutstrStore.getState().clearBalance();
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

// ── Client ───────────────────────────────────────────────────────────────

function createRoutstrClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: ROUTSTR_BASE_URL,
    timeout: 60_000,
    maxRetries: 2,
  });
}

// ── Public API ───────────────────────────────────────────────────────────

export async function getModels(): Promise<RoutstrModel[]> {
  apiLog.info('api.routstr.models.start');
  const start = performance.now();
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) await throwResponseError(response);

    const data: ModelsResponse = await response.json();
    const enabled = data.data.filter((model) => model.enabled);
    apiLog.info('api.routstr.models.success', { count: enabled.length, duration_ms: Math.round((performance.now() - start) * 100) / 100 });
    return enabled;
  } catch (error) {
    apiLog.error('api.routstr.models.failed', { error, duration_ms: Math.round((performance.now() - start) * 100) / 100 });
    toRoutstrError(error);
  }
}

export async function checkBalance(apiKey: string): Promise<BalanceResponse> {
  apiLog.debug('api.routstr.balance.start', { hasApiKey: !!apiKey, keyLength: apiKey?.length });
  const start = performance.now();
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/wallet/info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    apiLog.debug('api.routstr.balance.response', { status: response.status, duration_ms: Math.round(performance.now() - start) });
    if (!response.ok) await throwResponseError(response);

    const data = await response.json();
    const result = {
      balance: data.balance || 0,
      total_spent: data.total_spent || 0,
      api_key: data.api_key,
      reserved: data.reserved || 0,
    };
    apiLog.info('api.routstr.balance.success', { balance: result.balance, totalSpent: result.total_spent, reserved: result.reserved, hasServerKey: !!result.api_key, duration_ms: Math.round(performance.now() - start) });
    return result;
  } catch (error) {
    apiLog.error('api.routstr.balance.failed', { error, duration_ms: Math.round(performance.now() - start) });
    toRoutstrError(error);
  }
}

export async function topUpBalance(apiKey: string, cashuToken: string): Promise<TopUpResponse> {
  apiLog.info('api.routstr.wallet.topup.start', { tokenLength: cashuToken?.length });
  const start = performance.now();
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/wallet/topup?cashu_token=${encodeURIComponent(cashuToken)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    apiLog.debug('api.routstr.wallet.topup.response', { status: response.status, duration_ms: Math.round(performance.now() - start) });
    if (!response.ok) await throwResponseError(response);

    const data = await response.json();
    const result = { added_amount: data.msats || 0 };
    apiLog.info('api.routstr.wallet.topup.success', { addedAmount: result.added_amount, duration_ms: Math.round(performance.now() - start) });
    return result;
  } catch (error) {
    apiLog.error('api.routstr.wallet.topup.failed', { error, duration_ms: Math.round(performance.now() - start) });
    toRoutstrError(error);
  }
}

/**
 * Parse SSE stream manually for React Native compatibility.
 * Uses ReadableStream when available, falls back to full-text parsing.
 */
async function* parseSSEStream(
  response: Response
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const hasReadableStream = response.body && typeof response.body.getReader === 'function';
  apiLog.debug('routstr.sse.start', { hasReadableStream, contentType: response.headers.get('content-type') });
  if (hasReadableStream) {
    yield* parseSSEFromReadableStream(response.body!);
    return;
  }

  apiLog.warn('routstr.sse.no_readable_stream', { fallback: 'full_text_parse' });
  yield* parseSSEFromText(await response.text());
}

function tryParseSSELine(
  line: string
): OpenAI.Chat.Completions.ChatCompletionChunk | 'done' | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;
  const data = trimmed.slice(6).trim();
  if (data === '[DONE]') return 'done';
  if (!data) return null;
  try {
    return JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
  } catch {
    apiLog.warn('routstr.sse.parse_failed', { preview: data.substring(0, 100) });
    return null;
  }
}

async function* parseSSEFromReadableStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
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
          if (result) { chunkCount++; yield result; }
        }
        apiLog.info('routstr.sse.stream_end', { chunks: chunkCount, duration_ms: Math.round(performance.now() - streamStart) });
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const result = tryParseSSELine(line);
        if (result === 'done') {
          apiLog.info('routstr.sse.stream_end', { chunks: chunkCount, duration_ms: Math.round(performance.now() - streamStart) });
          return;
        }
        if (result) { chunkCount++; yield result; }
      }
    }
  } catch (error) {
    apiLog.error('routstr.sse.stream_error', { chunks: chunkCount, duration_ms: Math.round(performance.now() - streamStart), error });
    throw new Error(
      'Failed to stream response: ' + (error instanceof Error ? error.message : String(error))
    );
  } finally {
    reader.releaseLock();
  }
}

function* parseSSEFromText(text: string): Generator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  for (const line of text.split('\n')) {
    const result = tryParseSSELine(line);
    if (result === 'done') return;
    if (result) yield result;
  }
}

export async function sendMessage(
  apiKey: string,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  } = {}
): Promise<{
  response?: OpenAI.Chat.Completions.ChatCompletion;
  stream?: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
}> {
  const { model = 'gpt-3.5-turbo', temperature = 0.7, max_tokens, stream = false } = options;
  const totalTokens = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  apiLog.info('api.routstr.chat.start', { model, stream, messageCount: messages.length, totalInputChars: totalTokens, temperature, max_tokens });
  const start = performance.now();

  try {
    if (stream) {
      const response = await fetch(`${ROUTSTR_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature, ...(max_tokens != null && { max_tokens }), stream: true }),
      });
      const requestId = response.headers.get('x-routstr-request-id') || undefined;
      apiLog.debug('api.routstr.chat.response_received', { status: response.status, requestId, duration_ms: Math.round(performance.now() - start) });
      if (!response.ok) await throwResponseError(response);

      apiLog.info('api.routstr.chat.stream_started', { model, requestId, ttfb_ms: Math.round(performance.now() - start) });
      return { stream: parseSSEStream(response) };
    }

    const client = createRoutstrClient(apiKey);
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature,
      ...(max_tokens != null && { max_tokens }),
      stream: false,
    });
    apiLog.info('api.routstr.chat.success', { model, duration_ms: Math.round(performance.now() - start) });
    return { response };
  } catch (error: unknown) {
    apiLog.error('api.routstr.chat.failed', { model, error, duration_ms: Math.round(performance.now() - start) });
    toRoutstrError(error);
  }
}
