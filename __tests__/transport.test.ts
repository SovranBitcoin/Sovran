import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createNaggClient, parseGraphqlData } from '../src/transport';
import {
  createNaggCapabilityCache,
  NAGG_CAPABILITIES,
  probeServiceInfo,
} from '../src/capabilities';

describe('GraphQL transport', () => {
  test('parses envelope data through the supplied schema', () => {
    const result = parseGraphqlData(
      { data: { value: 42 } },
      z.object({ value: z.number() })
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ value: 42 });
  });

  test('maps GraphQL errors to typed Err values', () => {
    const result = parseGraphqlData(
      { errors: [{ message: 'bad query' }] },
      z.object({ value: z.number() })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe('graphql');
  });

  test('posts with timeout controls and parses data', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return Promise.resolve(
          new Response(JSON.stringify({ data: { pong: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }) as unknown as typeof fetch,
    });

    const result = await client.query({
      query: 'query Ping { pong }',
      dataSchema: z.object({ pong: z.boolean() }),
      refresh: true,
      timeoutMs: 250,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ pong: true });
    expect(requests[0]?.url).toContain('refresh=1');
    expect(requests[0]?.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('probes serviceInfo', async () => {
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                serviceInfo: {
                  graphqlSchemaVersion: '2026-06-04',
                  appViewVersion: 'v1',
                  capabilities: ['graphql.rank.shuffle'],
                  appViews: [{ version: 'v1', routes: ['/nostr/capabilities'] }],
                },
              },
            }),
            { status: 200 }
          )
        )) as unknown as typeof fetch,
    });

    const result = await probeServiceInfo(client);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().capabilities).toContain('graphql.rank.shuffle');
  });

  test('caches serviceInfo capability checks', async () => {
    let calls = 0;
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                serviceInfo: {
                  graphqlSchemaVersion: '2026-06-04',
                  appViewVersion: 'v1',
                  capabilities: [
                    NAGG_CAPABILITIES.EVENTS_SHUFFLE,
                    NAGG_CAPABILITIES.AGGREGATE_EVENTS_SHUFFLE,
                    NAGG_CAPABILITIES.RANK_SHUFFLE,
                    NAGG_CAPABILITIES.AUTHORED_REPLY_CHAIN,
                  ],
                  appViews: [{ version: 'v1', routes: ['/nostr/capabilities'] }],
                },
              },
            }),
            { status: 200 }
          )
        );
      }) as unknown as typeof fetch,
    });
    const cache = createNaggCapabilityCache(client);

    const supportsShuffle = await cache.supports(NAGG_CAPABILITIES.RANK_SHUFFLE);
    const supportsEventShuffle = await cache.supports(NAGG_CAPABILITIES.EVENTS_SHUFFLE);
    const supportsDerivedMetrics = await cache.supports('graphql.rank.derivedMetricTerms');

    expect(supportsShuffle.isOk()).toBe(true);
    expect(supportsShuffle._unsafeUnwrap()).toBe(true);
    expect(supportsEventShuffle.isOk()).toBe(true);
    expect(supportsEventShuffle._unsafeUnwrap()).toBe(true);
    expect(supportsDerivedMetrics.isOk()).toBe(true);
    expect(supportsDerivedMetrics._unsafeUnwrap()).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('App-view transport switch', () => {
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

  test('routes to the REST app-view and normalizes into the dataSchema shape', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      appView: { baseUrl: 'https://nagg.example', version: 'v1' },
      fetchImpl: jsonFetch(requests, { count: 7 }),
    });

    const result = await client.query({
      query: 'query Follows { x }',
      dataSchema: z.object({ followers: z.number() }),
      transport: 'appview',
      appView: {
        path: '/nostr/follows',
        searchParams: { pubkey: 'abc' },
        normalize: (raw) => ({ followers: (raw as { count: number }).count }),
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ followers: 7 });
    expect(requests[0]?.url).toBe('https://nagg.example/v1/nostr/follows?pubkey=abc');
    expect(requests[0]?.method).toBe('GET');
  });

  test('falls back to GraphQL when transport=appview but the request has no binding', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      appView: { baseUrl: 'https://nagg.example' },
      transport: 'appview',
      fetchImpl: jsonFetch(requests, { data: { pong: true } }),
    });

    const result = await client.query({
      query: 'query Ping { pong }',
      dataSchema: z.object({ pong: z.boolean() }),
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ pong: true });
    expect(requests[0]?.url).toBe('https://nagg.example/graphql');
    expect(requests[0]?.method).toBe('POST');
  });

  test('client.rest parses the raw app-view JSON and strips a trailing base slash', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
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
  });

  test('client.rest errors when no app-view base is configured', async () => {
    const client = createNaggClient({ endpoint: 'https://nagg.example/graphql' });
    const result = await client.rest({
      path: '/nostr/profile',
      responseSchema: z.object({}),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe('endpoint_required');
  });

  test('builds app-view URLs with array params, refresh bypass, and POST body', async () => {
    const requests: Request[] = [];
    const client = createNaggClient({
      endpoint: 'https://nagg.example/graphql',
      appView: { baseUrl: 'https://nagg.example', version: 'v1' },
      transport: 'appview',
      fetchImpl: jsonFetch(requests, { ids: ['a'] }),
    });

    const result = await client.query({
      query: 'query Events { x }',
      dataSchema: z.object({ ids: z.array(z.string()) }),
      refresh: true,
      appView: {
        method: 'POST',
        path: 'nostr/events', // no leading slash — client normalizes it
        searchParams: { ids: ['a', 'b'], empty: [], skip: undefined },
        body: { ids: ['a', 'b'] },
        normalize: (raw) => raw,
      },
    });

    expect(result.isOk()).toBe(true);
    const req = requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('https://nagg.example/v1/nostr/events?');
    expect(req.url).toContain('ids=a%2Cb'); // joined by comma
    expect(req.url).not.toContain('empty='); // empty array skipped
    expect(req.url).not.toContain('skip='); // undefined skipped
    expect(req.url).toContain('refresh=1');
    expect(req.headers.get('Cache-Control')).toBe('no-cache');
  });
});
