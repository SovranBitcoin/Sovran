import { describe, expect, it } from 'vitest';
import {
  directVertexToProfilesEnvelope,
  sendDirectVertexRequest,
  VERTEX_RELAY_URL,
  type VertexSocketLike,
} from '../src/facade/vertex-direct';
import type { SignedVertexRequest } from '../src/facade/vertex-request';

class FakeVertexSocket implements VertexSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.closed = true;
  }

  emit(type: string, event?: unknown): void {
    if (type === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

function makeSigned(kind: 5312 | 5315 = 5315): SignedVertexRequest {
  return {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    sig: '3'.repeat(128),
    kind,
    created_at: 1_700_000_000,
    tags:
      kind === 5315
        ? [
            ['param', 'search', 'alice'],
            ['param', 'sort', 'globalPagerank'],
            ['param', 'limit', '10'],
          ]
        : [
            ['param', 'target', PUBKEY_A],
            ['param', 'sort', 'globalPagerank'],
            ['param', 'limit', '10'],
          ],
    content: '',
  };
}

describe('sendDirectVertexRequest', () => {
  it('subscribes before publishing and parses a kind 6315 search response', async () => {
    const socket = new FakeVertexSocket();
    let seenUrl = '';
    const signed = makeSigned(5315);

    const promise = sendDirectVertexRequest(signed, {
      createWebSocket: (url) => {
        seenUrl = url;
        return socket;
      },
    });

    socket.emit('open');
    expect(seenUrl).toBe(VERTEX_RELAY_URL);
    expect(socket.sent).toHaveLength(2);
    const reqFrame = JSON.parse(socket.sent[0]);
    const eventFrame = JSON.parse(socket.sent[1]);
    expect(reqFrame[0]).toBe('REQ');
    expect(reqFrame[2]).toEqual({ kinds: [6315, 7000], '#e': [signed.id] });
    expect(eventFrame).toEqual(['EVENT', signed]);

    const subId = reqFrame[1];
    socket.emit('message', {
      data: JSON.stringify([
        'EVENT',
        subId,
        {
          kind: 6315,
          tags: [
            ['e', signed.id],
            ['nodes', '500000'],
          ],
          content: JSON.stringify([
            { pubkey: PUBKEY_A, rank: 0.85 },
            { pubkey: PUBKEY_B, rank: '0.42' },
          ]),
        },
      ]),
    });

    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('search');
      expect(result.nodes).toBe(500000);
      expect(result.entries).toEqual([
        { pubkey: PUBKEY_A, rank: 0.85, follows: undefined, followers: undefined },
        { pubkey: PUBKEY_B, rank: 0.42, follows: undefined, followers: undefined },
      ]);

      const envelope = directVertexToProfilesEnvelope(result);
      expect(envelope.pubkeys).toEqual([PUBKEY_A, PUBKEY_B]);
      expect(envelope.vertexFresh).toBe(true);
      expect(envelope.providers?.[PUBKEY_A]?.vertex?.score).toBe(0.85);
      expect(envelope.providers?.[PUBKEY_B]?.vertex?.rank).toBe(2);
    }
    expect(socket.closed).toBe(true);
  });

  it('parses kind 6312 profile reputation with follows and followers', async () => {
    const socket = new FakeVertexSocket();
    const signed = makeSigned(5312);
    const promise = sendDirectVertexRequest(signed, { createWebSocket: () => socket });

    socket.emit('open');
    const subId = JSON.parse(socket.sent[0])[1];
    socket.emit('message', {
      data: JSON.stringify([
        'EVENT',
        subId,
        {
          kind: 6312,
          tags: [['e', signed.id]],
          content: JSON.stringify([
            { pubkey: PUBKEY_A, rank: 0.91, follows: 120, followers: 4500 },
            { pubkey: PUBKEY_B, rank: 0.5 },
          ]),
        },
      ]),
    });

    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      const envelope = directVertexToProfilesEnvelope(result, PUBKEY_A);
      expect(envelope.aggregates?.[PUBKEY_A]).toEqual({ followers: 4500, following: 120 });
      expect(envelope.providers?.[PUBKEY_A]?.vertex?.score).toBe(0.91);
    }
  });

  it('maps kind 7000 payment-required to insufficient_credits', async () => {
    const socket = new FakeVertexSocket();
    const signed = makeSigned(5315);
    const promise = sendDirectVertexRequest(signed, { createWebSocket: () => socket });

    socket.emit('open');
    const subId = JSON.parse(socket.sent[0])[1];
    socket.emit('message', {
      data: JSON.stringify([
        'EVENT',
        subId,
        {
          kind: 7000,
          tags: [
            ['e', signed.id],
            ['status', 'payment-required', 'not enough credits'],
          ],
          content: '',
        },
      ]),
    });

    const result = await promise;
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient_credits',
      message: 'not enough credits',
    });
  });

  it('maps OK false rejection to rejected or insufficient_credits', async () => {
    const socket = new FakeVertexSocket();
    const signed = makeSigned(5315);
    const promise = sendDirectVertexRequest(signed, { createWebSocket: () => socket });

    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify(['OK', signed.id, false, 'insufficient credit balance']),
    });

    const result = await promise;
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient_credits',
      message: 'insufficient credit balance',
    });
  });

  it('aborts cleanly when signal fires', async () => {
    const socket = new FakeVertexSocket();
    const controller = new AbortController();
    const promise = sendDirectVertexRequest(makeSigned(5315), {
      signal: controller.signal,
      createWebSocket: () => socket,
    });
    socket.emit('open');
    controller.abort();
    const result = await promise;
    expect(result).toEqual({ ok: false, reason: 'timeout', message: 'aborted' });
    expect(socket.closed).toBe(true);
  });
});
