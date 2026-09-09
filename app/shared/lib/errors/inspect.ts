import { Result } from 'neverthrow';

interface ErrorNode {
  name?: string;
  type?: string;
  code?: string | number;
  status?: number;
  messages: string[];
}

/** Only inspect known error envelopes, never arbitrary objects or request bodies.
 * Bounded traversal handles Error.cause, Coco wrappers, FastAPI/OpenAI envelopes,
 * and Nagg errors without serializing secrets or looping on cycles. */
function inspect(error: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = [];
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  for (let i = 0; i < queue.length && i < 16; i++) {
    const value = queue[i];
    if (typeof value === 'string') {
      nodes.push({ messages: [value.slice(0, 2048)] });
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    // SDK errors use ordinary fields, including non-enumerable Error properties.
    const messages = [record.message, record.detail, record.error]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.slice(0, 2048));
    const status = record.status ?? record.statusCode;
    nodes.push({
      name: typeof record.name === 'string' ? record.name : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
      code:
        typeof record.code === 'number' || typeof record.code === 'string'
          ? record.code
          : undefined,
      status: typeof status === 'number' && Number.isInteger(status) ? status : undefined,
      messages,
    });
    for (const key of ['cause', 'error', 'detail', 'data'] as const) {
      if (record[key] && typeof record[key] === 'object' && queue.length < 16)
        queue.push(record[key]);
    }
    // Do not flatten aggregate errors or relayResults: one failure must not
    // describe the outcome of all operations or relays.
  }
  return nodes;
}

// Error UI must survive third-party errors with throwing property accessors.
export const inspectError = Result.fromThrowable(inspect, () => 'unreadable_error' as const);
