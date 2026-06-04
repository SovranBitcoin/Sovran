import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createNaggClient, parseGraphqlData } from '../src/transport';
import { probeServiceInfo } from '../src/capabilities';

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
});
