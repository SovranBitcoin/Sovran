import OpenAI from 'openai';

const ROUTSTR_BASE_URL = 'https://api.routstr.com/v1';

export interface BalanceResponse {
  balance: number; // msats
  total_spent?: number; // msats (optional, may not be in response)
  api_key?: string; // API key (returned when using Cashu token directly)
  reserved?: number; // Reserved balance
}

export interface TopUpResponse {
  new_balance: number; // msats
  added_amount: number; // msats
}

export interface CreateWalletResponse {
  api_key: string;
  balance: number; // msats
  created_at: string;
  key_id: string;
}

export interface RoutstrError {
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

/**
 * Helper function to detect if a response is HTML
 */
function isHTMLResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html');
}

/**
 * Helper function to extract error message from HTML response
 */
async function extractErrorMessageFromHTML(response: Response): Promise<string> {
  try {
    const html = await response.text();
    // Try to extract meaningful error message from Cloudflare error pages
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1];
      // Extract error code and message (e.g., "routstr.com | 502: Bad gateway")
      const errorMatch = title.match(/(\d+):\s*(.+)/);
      if (errorMatch) {
        return `${errorMatch[1]} ${errorMatch[2]}`;
      }
      return title.replace(/^[^|]+\s*\|\s*/, ''); // Remove domain prefix
    }
    // Fallback to status text
    return response.statusText || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Helper function to parse error response (handles both JSON and HTML)
 */
async function parseErrorResponse(response: Response): Promise<any> {
  if (isHTMLResponse(response)) {
    const message = await extractErrorMessageFromHTML(response);
    return {
      message,
      type: response.status >= 500 ? 'server_error' : 'client_error',
    };
  }

  try {
    return await response.json();
  } catch {
    return {
      message: response.statusText || `HTTP ${response.status}`,
      type: 'unknown_error',
    };
  }
}

/**
 * Helper function to create user-friendly error messages
 */
function getUserFriendlyErrorMessage(status: number, errorData: any): string {
  if (status === 502 || status === 503) {
    return 'Service temporarily unavailable. Please try again in a few minutes.';
  }
  if (status === 504) {
    return 'Request timeout. The service is taking too long to respond.';
  }
  if (status === 401) {
    return 'Authentication failed. Please check your API key.';
  }
  if (status === 402) {
    return errorData.error?.message || 'Insufficient balance. Please top up your account.';
  }
  if (status === 429) {
    return 'Rate limit exceeded. Please wait a moment before trying again.';
  }
  return errorData.error?.message || errorData.message || `HTTP ${status} error`;
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
  canonical_slug: string;
  alias_ids: string[] | null;
}

export interface ModelsResponse {
  data: RoutstrModel[];
}

/**
 * Create OpenAI client configured for Routstr API
 */
function createRoutstrClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: ROUTSTR_BASE_URL,
    timeout: 60000, // 60 seconds
    maxRetries: 2,
  });
}

/**
 * Get available models from Routstr API
 */
export async function getModels(apiKey: string): Promise<RoutstrModel[]> {
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await parseErrorResponse(response);
      const error: RoutstrError = {
        status: response.status,
        error: {
          message: getUserFriendlyErrorMessage(response.status, errorData),
          type: errorData.type || 'unknown_error',
          details: errorData.details,
        },
      };
      throw error;
    }

    const data: ModelsResponse = await response.json();
    // Filter to only enabled models
    return data.data.filter((model) => model.enabled);
  } catch (error: any) {
    if (error.status) {
      throw error; // Re-throw RoutstrError
    }
    // Network or other errors
    throw {
      status: 0,
      error: {
        message: error.message || 'Network error',
        type: 'network_error',
      },
    } as RoutstrError;
  }
}

/**
 * Check balance for a Routstr wallet
 */
export async function checkBalance(apiKey: string): Promise<BalanceResponse> {
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/wallet/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await parseErrorResponse(response);
      const error: RoutstrError = {
        status: response.status,
        error: {
          message: getUserFriendlyErrorMessage(response.status, errorData),
          type: errorData.type || 'unknown_error',
          details: errorData.details,
        },
      };
      throw error;
    }

    const data = await response.json();
    console.log(
      'checkBalance response:',
      JSON.stringify({ apiKey: apiKey?.substring(0, 20) + '...', response: data })
    );
    return {
      balance: data.balance || 0,
      total_spent: data.total_spent || 0,
      api_key: data.api_key,
      reserved: data.reserved || 0,
    };
  } catch (error: any) {
    if (error.status) {
      throw error; // Re-throw RoutstrError
    }
    // Network or other errors
    throw {
      status: 0,
      error: {
        message: error.message || 'Network error',
        type: 'network_error',
      },
    } as RoutstrError;
  }
}

/**
 * Create a Routstr wallet from a Cashu token
 * Note: This endpoint may not be available yet. Falls back to using token directly as API key.
 */
export async function createWalletFromToken(
  cashuToken: string
): Promise<CreateWalletResponse | null> {
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/wallet/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cashu_token: cashuToken }),
    });

    if (!response.ok) {
      // If endpoint doesn't exist yet (404), return null to use token directly
      if (response.status === 404) {
        return null;
      }
      const errorData = await parseErrorResponse(response);
      const error: RoutstrError = {
        status: response.status,
        error: {
          message: getUserFriendlyErrorMessage(response.status, errorData),
          type: errorData.type || 'unknown_error',
          details: errorData.details,
        },
      };
      throw error;
    }

    const data = await response.json();
    return {
      api_key: data.api_key,
      balance: data.balance || 0,
      created_at: data.created_at,
      key_id: data.key_id,
    };
  } catch (error: any) {
    // If endpoint doesn't exist, return null to use token directly
    if (error.status === 404 || error.message?.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Top up balance using a Cashu token
 */
export async function topUpBalance(apiKey: string, cashuToken: string): Promise<TopUpResponse> {
  try {
    const response = await fetch(`${ROUTSTR_BASE_URL}/wallet/topup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cashu_token: cashuToken }),
    });

    if (!response.ok) {
      const errorData = await parseErrorResponse(response);
      const error: RoutstrError = {
        status: response.status,
        error: {
          message: getUserFriendlyErrorMessage(response.status, errorData),
          type: errorData.type || 'unknown_error',
          details: errorData.details,
        },
      };
      throw error;
    }

    const data = await response.json();
    return {
      new_balance: data.new_balance || 0,
      added_amount: data.added_amount || 0,
    };
  } catch (error: any) {
    if (error.status) {
      throw error; // Re-throw RoutstrError
    }
    // Network or other errors
    throw {
      status: 0,
      error: {
        message: error.message || 'Network error',
        type: 'network_error',
      },
    } as RoutstrError;
  }
}

/**
 * Parse SSE (Server-Sent Events) stream manually for React Native compatibility
 * Processes chunks incrementally as they arrive for true streaming behavior
 */
async function* parseSSEStream(
  response: Response
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  // Try to use ReadableStream if available (works in some React Native versions)
  if (response.body && typeof response.body.getReader === 'function') {
    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  reader.releaseLock();
                  return;
                }
                if (data) {
                  try {
                    const chunk = JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
                    yield chunk;
                  } catch (e) {
                    console.warn('Failed to parse SSE chunk:', data, e);
                  }
                }
              }
            }
          }
          reader.releaseLock();
          return;
        }

        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete lines (ending with \n)
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        // Process each complete line immediately
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          // Skip empty lines and non-data lines
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
            continue;
          }

          const data = trimmedLine.slice(6).trim();
          
          // Check for end marker
          if (data === '[DONE]') {
            reader.releaseLock();
            return;
          }

          // Parse and yield chunk immediately
          if (data) {
            try {
              const parsedChunk = JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
              // Log first few chunks for debugging
              const hasContent = !!parsedChunk.choices?.[0]?.delta?.content;
              if (hasContent) {
                console.log('SSE: Yielding chunk with content:', {
                  contentLength: parsedChunk.choices[0].delta.content?.length,
                  contentPreview: parsedChunk.choices[0].delta.content?.substring(0, 50),
                });
              }
              yield parsedChunk;
            } catch (e) {
              // Skip invalid JSON - might be partial data or malformed chunk
              console.warn('Failed to parse SSE chunk:', data.substring(0, 100), e);
            }
          }
        }
      }
    } catch (error) {
      // If streaming fails, log error but don't fall back to full response
      // This ensures we fail fast rather than silently degrading to non-streaming
      console.error('Streaming error:', error);
      throw new Error('Failed to stream response: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Fallback: If ReadableStream is not available, we need to read in chunks
  // This is a last resort and will still try to process incrementally
  console.warn('ReadableStream not available, using fallback method - this may cause delayed updates');
  
  try {
    // Try to read response as text stream if possible
    const text = await response.text();
    console.log('Fallback: Read full response, length:', text.length);
    const lines = text.split('\n');
    console.log('Fallback: Total lines:', lines.length);

    let chunkCount = 0;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
        continue;
      }

      const data = trimmedLine.slice(6).trim();
      if (data === '[DONE]') {
        console.log('Fallback: Received [DONE] marker after', chunkCount, 'chunks');
        return;
      }
      
      if (data) {
        try {
          const chunk = JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
          chunkCount++;
          const hasContent = !!chunk.choices?.[0]?.delta?.content;
          if (hasContent && chunkCount <= 3) {
            console.log('Fallback: Yielding chunk', chunkCount, 'with content');
          }
          yield chunk;
        } catch (e) {
          console.warn('Failed to parse SSE chunk in fallback:', data.substring(0, 100), e);
        }
      }
    }
    console.log('Fallback: Processed', chunkCount, 'chunks total');
  } catch (error) {
    console.error('Fallback parsing failed:', error);
    throw error;
  }
}

/**
 * Send a chat message with streaming support
 * Uses manual SSE parsing for React Native compatibility
 */
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
  const { model = 'gpt-3.5-turbo', temperature = 0.7, max_tokens = 200, stream = false } = options;

  try {
    if (stream) {
      // Use manual fetch with SSE parsing for React Native streaming support
      const response = await fetch(`${ROUTSTR_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorData = await parseErrorResponse(response);
        const error: RoutstrError = {
          status: response.status,
          error: {
            message: getUserFriendlyErrorMessage(response.status, errorData),
            type: errorData.type || 'unknown_error',
            details: errorData.details,
          },
        };
        throw error;
      }

      // Return async generator for streaming
      return { stream: parseSSEStream(response) };
    } else {
      // Non-streaming: use OpenAI client
      const client = createRoutstrClient(apiKey);
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false,
      });

      return { response };
    }
  } catch (error: any) {
    // Handle errors and convert to RoutstrError format
    if (error.status) {
      // Check if error message contains HTML (502/503 errors from Cloudflare)
      const errorMessage = error.message || '';
      const isHTML = errorMessage.includes('<!DOCTYPE') || errorMessage.includes('<html');

      let friendlyMessage = error.message || `HTTP ${error.status}`;
      if (isHTML || error.status === 502 || error.status === 503) {
        friendlyMessage = getUserFriendlyErrorMessage(error.status, {});
      } else if (error.error?.message) {
        friendlyMessage = getUserFriendlyErrorMessage(error.status, error.error);
      }

      const routstrError: RoutstrError = {
        status: error.status,
        error: {
          message: friendlyMessage,
          type: error.type || (error.status >= 500 ? 'server_error' : 'api_error'),
          details: error.error?.details || {},
        },
      };
      throw routstrError;
    }

    // Network or other errors
    throw {
      status: 0,
      error: {
        message: error.message || 'Network error. Please check your connection.',
        type: 'network_error',
      },
    } as RoutstrError;
  }
}

/**
 * Retry helper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (attempt === maxRetries - 1) {
        throw error;
      }

      // Don't retry on 402 (insufficient balance) or 401 (auth error)
      if (error.status === 402 || error.status === 401) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), 60000);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}
