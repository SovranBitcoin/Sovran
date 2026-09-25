/**
 * @fileoverview A `Response` that can actually hold a `ReadableStream`.
 *
 * Expo's WinterCG runtime replaces `globalThis.fetch` with `expo/fetch` — which
 * returns responses whose `body` is a real `ReadableStream` — but deliberately
 * leaves React Native's `Headers`/`Request`/`Response` in place. Those come from
 * `whatwg-fetch`, whose `_initBody` ends with:
 *
 *     } else { this._bodyText = body = Object.prototype.toString.call(body) }
 *
 * So `new Response(stream)` does not store the stream. It stores the string
 * `"[object ReadableStream]"` — 23 characters — and exposes no `body` at all.
 *
 * Anything that re-wraps a streaming response is therefore silently destroying
 * it. `@routstr/sdk` does exactly that: it tees a `text/event-stream` body to
 * inspect usage, and hands back `new Response(clientStream, …)`. The observed
 * result was a chat turn that cost real sats, answered HTTP 200 in ~6.6s, and
 * yielded `chunks: 0, chars: 0` — the whole answer stringified away.
 *
 * This restores the one behaviour that is missing. A stream body is kept as the
 * stream, `body` returns it, and the body-reading methods drain it once, with
 * the same single-use semantics the spec gives them. Every other body type is
 * handed straight to the platform class, so nothing else changes.
 */

/** The stream shape a `Response` body actually is, spelled the way the DOM
 *  lib spells it so the override stays assignable to `Response.body`. */
type StreamLike = NonNullable<Response['body']>;

interface ResponseCtor {
  new (body?: unknown, init?: ResponseInit): Response;
  prototype: Response;
}

/** A body the platform class would stringify rather than store. */
function isReadableStream(value: unknown): value is StreamLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StreamLike).getReader === 'function' &&
    typeof (value as StreamLike).tee === 'function'
  );
}

/** Per-instance stream state, kept off the instance so it cannot collide with
 *  the platform class's own fields. */
const streams = new WeakMap<Response, { stream: StreamLike; used: boolean }>();

async function drain(stream: StreamLike): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      length += value.byteLength;
    }
  }
  const joined = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/**
 * Wrap a `Response` class so a `ReadableStream` body survives construction.
 *
 * Exported separately from the install so a test can drive it against a stub
 * base class instead of whatever the host happens to provide.
 */
export function createStreamCapableResponse(Base: ResponseCtor): ResponseCtor {
  class StreamCapableResponse extends (Base as unknown as {
    new (body?: unknown, init?: ResponseInit): Response;
  }) {
    constructor(body?: unknown, init?: ResponseInit) {
      const stream = isReadableStream(body) ? body : null;
      // The platform class is given no body at all rather than the stream it
      // would stringify; this class answers every body read instead.
      super(stream ? undefined : body, init);
      if (!stream) return;
      const held = { stream, used: false };
      streams.set(this, held);
      // `whatwg-fetch` assigns `this.bodyUsed` in its constructor, and an own
      // property shadows a prototype getter — so the override has to be an own
      // accessor or every reader still sees the platform's `false`.
      Object.defineProperty(this, 'bodyUsed', {
        configurable: true,
        get: () => held.used,
      });
    }

    override get body(): StreamLike | null {
      const held = streams.get(this);
      if (held) return held.stream;
      const inherited = (Base.prototype as { body?: StreamLike | null }).body;
      return inherited ?? null;
    }

    /** Take the stream exactly once, the way a spec body read does. */
    private takeStream(): StreamLike | null {
      const held = streams.get(this);
      if (!held) return null;
      if (held.used) throw new TypeError('Already read');
      held.used = true;
      return held.stream;
    }

    override async arrayBuffer(): Promise<ArrayBuffer> {
      const stream = this.takeStream();
      if (!stream) return super.arrayBuffer();
      const bytes = await drain(stream);
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
    }

    override async text(): Promise<string> {
      const stream = this.takeStream();
      if (!stream) return super.text();
      return new TextDecoder('utf-8').decode(await drain(stream));
    }

    override async json(): Promise<unknown> {
      const held = streams.get(this);
      if (!held) return super.json();
      return JSON.parse(await this.text());
    }

    /**
     * A clone must not hand two readers the same stream. Teeing gives each
     * copy its own, which is what the spec's clone does and what the SDK's
     * error path (`response.clone()`) assumes.
     */
    override clone(): Response {
      const held = streams.get(this);
      if (!held) return super.clone();
      if (held.used) throw new TypeError('Already read');
      const [mine, theirs] = held.stream.tee();
      held.stream = mine;
      return new StreamCapableResponse(theirs, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
      });
    }
  }

  return StreamCapableResponse as unknown as ResponseCtor;
}

/**
 * Install the wrapper over the host's `Response`, once.
 *
 * A host that already keeps stream bodies is left alone — this exists to close
 * a gap, not to take ownership of a class that works.
 */
export function installStreamCapableResponse(host: { Response?: unknown } = globalThis): boolean {
  const Base = host.Response as ResponseCtor | undefined;
  if (typeof Base !== 'function') return false;
  if (alreadyStreamCapable(Base)) return false;
  host.Response = createStreamCapableResponse(Base);
  return true;
}

function alreadyStreamCapable(Base: ResponseCtor): boolean {
  // No global to probe with is not evidence that the base is fine, and
  // skipping on that basis would reinstate the bug silently at whatever
  // point in boot the global happens not to exist yet. Wrapping costs
  // nothing: a non-stream body is handed straight to the base class.
  if (typeof ReadableStream !== 'function') return false;
  try {
    return new Base(new ReadableStream()).body != null;
  } catch {
    // A base that refuses a stream outright is exactly the gap this closes.
    return false;
  }
}
