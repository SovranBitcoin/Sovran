import { describe, it, expect, vi } from 'vitest';
import {
  buildVertexRequest,
  encodeSignedVertexRequest,
} from '../src/facade/vertex-request';
import { createNaggClient } from '../src/transport';
import { profileAppView } from '../src/recipes/vertex';

const target = 'a'.repeat(64);
const signed = {
  ...buildVertexRequest({ kind: 'search', query: 'éclair' }),
  id: 'b'.repeat(64),
  pubkey: target,
  sig: 'c'.repeat(128),
};

describe('Vertex request', () => {
  it.each([
    ['profile', 5312],
    ['search', 5315],
    ['recommend', 5313],
  ] as const)(
    '%s has bounded global-only parameters and no content',
    (kind, eventKind) => {
      const before = Math.floor(Date.now() / 1000);
      const event = buildVertexRequest({
        kind,
        target,
        query: 'alice',
        limit: 7,
      });
      expect(event.kind).toBe(eventKind);
      expect(event.content).toBe('');
      expect(event.created_at).toBeGreaterThanOrEqual(before);
      expect(event.tags).toEqual([
        ...(kind === 'profile'
          ? [['param', 'target', target]]
          : kind === 'search'
            ? [['param', 'search', 'alice']]
            : []),
        ['param', 'sort', 'globalPagerank'],
        ['param', 'limit', '7'],
      ]);
      expect(JSON.stringify(event)).not.toContain('personalized');
    },
  );

  it('encodes Unicode JSON as unpadded base64url in svr for the profile recipe', () => {
    const encoded = encodeSignedVertexRequest(signed);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString())).toEqual(
      signed,
    );
    expect(
      profileAppView({ pubkey: target, signedVertexRequest: signed })
        .searchParams?.svr,
    ).toBe(encoded);
  });

  it('posts only the signed event and preserves credit failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, reason: 'insufficient_credits' }),
        ),
      );
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.vertexRelay(signed);
    expect(result._unsafeUnwrap()).toEqual({
      ok: false,
      reason: 'insufficient_credits',
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(signed),
      cache: 'no-store',
    });
  });

});

it('preserves typed Vertex deadline failures on HTTP 504', async () => {
  const client = createNaggClient({
    appView: { baseUrl: 'https://nagg.test' },
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ok: false, reason: 'timeout' }), {
        status: 504,
      })) as unknown as typeof fetch,
  });
  expect((await client.vertexRelay(signed))._unsafeUnwrap()).toEqual({
    ok: false,
    reason: 'timeout',
  });
});
