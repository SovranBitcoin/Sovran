/**
 * @jest-environment node
 *
 * The bug this closes, exactly as it happened: Expo's WinterCG runtime swaps
 * `globalThis.fetch` for the streaming `expo/fetch` but leaves React Native's
 * `whatwg-fetch` `Response` in place. `whatwg-fetch`'s `_initBody` ends with
 * `this._bodyText = Object.prototype.toString.call(body)`, so `new
 * Response(stream)` stores the 23-character string "[object ReadableStream]"
 * and exposes no `body`. `@routstr/sdk` re-wraps every `text/event-stream`
 * response that way, which is why a paid chat turn came back HTTP 200 with
 * `chunks: 0, chars: 0`.
 *
 * `WhatwgLikeResponse` below reproduces that `_initBody` branch, so these tests
 * fail against the unwrapped class for the real reason rather than a stand-in.
 */
import {
  createStreamCapableResponse,
  installStreamCapableResponse,
} from '@/shared/lib/http/streamResponse';

/** The `whatwg-fetch` body-init branch that loses the stream. */
class WhatwgLikeResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  bodyUsed = false;
  private bodyText: string;

  constructor(body?: unknown, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.statusText = init?.statusText ?? '';
    this.headers = new Headers(init?.headers);
    this.bodyText =
      body == null ? '' : typeof body === 'string' ? body : Object.prototype.toString.call(body);
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return this.bodyText;
  }
  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return new TextEncoder().encode(await this.text()).buffer as ArrayBuffer;
  }
  clone(): WhatwgLikeResponse {
    return new WhatwgLikeResponse(this.bodyText, { status: this.status });
  }
}

type Ctor = Parameters<typeof createStreamCapableResponse>[0];
const Base = WhatwgLikeResponse as unknown as Ctor;

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const SSE = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';

describe('stream-capable Response', () => {
  it('reproduces the loss it exists to prevent', async () => {
    const lost = new WhatwgLikeResponse(streamOf(SSE));
    const text = await lost.text();
    expect(text).toBe('[object ReadableStream]');
    // The number the device log reported as the whole answer.
    expect(text).toHaveLength(23);
  });

  it('keeps a stream body readable through `body`', async () => {
    const Wrapped = createStreamCapableResponse(Base);
    const response = new Wrapped(streamOf('data: a\n\n', 'data: b\n\n'));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    expect(out).toBe('data: a\n\ndata: b\n\n');
  });

  it('drains the stream for text() and json()', async () => {
    const Wrapped = createStreamCapableResponse(Base);
    expect(await new Wrapped(streamOf(SSE)).text()).toBe(SSE);
    expect(await new Wrapped(streamOf('{"ok":true}')).json()).toEqual({ ok: true });
  });

  it('keeps single-use body semantics', async () => {
    const Wrapped = createStreamCapableResponse(Base);
    const response = new Wrapped(streamOf('once'));
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('once');
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toThrow('Already read');
  });

  it('gives a clone its own stream instead of a second reader on one', async () => {
    const Wrapped = createStreamCapableResponse(Base);
    const response = new Wrapped(streamOf('shared'), { status: 201 });
    const copy = response.clone();
    expect(copy.status).toBe(201);
    expect(await copy.text()).toBe('shared');
    expect(await response.text()).toBe('shared');
  });

  it('leaves every other body type to the platform class', async () => {
    const Wrapped = createStreamCapableResponse(Base);
    const response = new Wrapped('plain text', { status: 404 });
    expect(response.body).toBeNull();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('plain text');
  });

  it('installs over a host that loses streams, and only once', () => {
    const host: { Response?: unknown } = { Response: Base };
    expect(installStreamCapableResponse(host)).toBe(true);
    const wrapped = host.Response;
    // A host that already keeps streams is not ours to take over.
    expect(installStreamCapableResponse(host)).toBe(false);
    expect(host.Response).toBe(wrapped);
  });

  it('does nothing when the host has no Response at all', () => {
    expect(installStreamCapableResponse({})).toBe(false);
  });

  // Boot order decides whether `ReadableStream` is a global yet. Treating its
  // absence as "the base is fine" would put the bug back, silently, on exactly
  // the runs where the probe cannot be made.
  it('installs anyway when there is no ReadableStream to probe with', () => {
    const globalWithStream = globalThis as { ReadableStream?: unknown };
    const saved = globalWithStream.ReadableStream;
    delete globalWithStream.ReadableStream;
    try {
      expect(installStreamCapableResponse({ Response: Base })).toBe(true);
    } finally {
      globalWithStream.ReadableStream = saved;
    }
  });
});
