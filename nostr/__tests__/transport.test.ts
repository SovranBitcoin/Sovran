import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createNaggClient } from '../src/transport';

function jsonFetch(requests: Request[], body: unknown) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as unknown as typeof fetch;
}

describe('app-view REST transport', () => {
  test('parses the raw app-view JSON and strips a trailing base slash', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.example/' },
      fetchImpl: jsonFetch(requests, { pubkey: 'abc', followers: 3 }),
    });

    const result = await client.rest({
      path: '/nostr/profile',
      searchParams: { pubkey: 'abc' },
      responseSchema: z.object({ pubkey: z.string(), followers: z.number() }),
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ pubkey: 'abc', followers: 3 });
    expect(requests[0]?.url).toBe('https://nagg.example/nostr/profile?pubkey=abc');
    expect(requests[0]?.method).toBe('GET');
  });

  test('surfaces a schema mismatch as a typed Err', async () => {
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.example' },
      fetchImpl: jsonFetch([], { unexpected: true }),
    });
    const result = await client.rest({
      path: '/nostr/profile',
      responseSchema: z.object({ pubkey: z.string() }),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe('schema');
  });

  test('builds app-view URLs with array params, refresh bypass, and POST body', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.example', version: 'v1' },
      fetchImpl: jsonFetch(requests, { ids: ['a'] }),
    });

    const result = await client.rest({
      method: 'POST',
      path: 'nostr/events/query', // no leading slash — client normalizes it
      searchParams: { ids: ['a', 'b'], empty: [], skip: undefined },
      body: { ids: ['a', 'b'] },
      responseSchema: z.object({ ids: z.array(z.string()) }),
      refresh: true,
    });

    expect(result.isOk()).toBe(true);
    const req = requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('https://nagg.example/v1/nostr/events/query?');
    expect(req.url).toContain('ids=a%2Cb'); // joined by comma
    expect(req.url).not.toContain('empty='); // empty array skipped
    expect(req.url).not.toContain('skip='); // undefined skipped
    expect(req.url).toContain('refresh=1');
    expect(req.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('honours timeoutMs controls', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.example' },
      fetchImpl: jsonFetch(requests, { pong: true }),
    });
    const result = await client.rest({
      path: '/nostr/capabilities',
      responseSchema: z.object({ pong: z.boolean() }),
      timeoutMs: 250,
    });
    expect(result.isOk()).toBe(true);
  });
});
