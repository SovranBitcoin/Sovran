/**
 * Pins request consolidation: the SHA-256-backed group keys (retry-shaped
 * sign_events group, payload differences never do), same-peer decrypt
 * grouping, first-occurrence anchoring across interleaved apps, the
 * block-action head-only special case, and the departed-group classifier.
 */

import type { Nip46PendingRequest } from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  consolidatePending,
  groupDeparted,
  requestGroupKey,
  verdictIdsForGroup,
} from '@/features/nostrSigner/lib/requestGrouping';

const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);
const PEER_X = 'e'.repeat(64);
const PEER_Y = 'f'.repeat(64);

let seq = 0;

function request(overrides: Partial<Nip46PendingRequest> = {}): Nip46PendingRequest {
  seq += 1;
  return {
    id: `rpc-${seq}`,
    eventId: `${seq}`.padStart(64, '0'),
    clientPubkey: APP_A,
    method: 'sign_event',
    kind: 30078,
    paramsPreview: {
      type: 'sign_event',
      event: {
        kind: 30078,
        content: '{ "description": "Sync app settings" }',
        tags: [['d', 'Primal-Web App', 'get_app_settings']],
        created_at: 1_781_087_003 + seq,
      },
    },
    receivedAt: 1_000 + seq,
    expiresAt: 121_000 + seq,
    ...overrides,
  };
}

function decryptRequest(peer: string, length: number, app = APP_A): Nip46PendingRequest {
  return request({
    clientPubkey: app,
    method: 'nip44_decrypt',
    kind: undefined,
    paramsPreview: { type: 'decrypt', peerPubkey: peer, ciphertextLength: length },
  });
}

describe('requestGroupKey', () => {
  it('groups sign_event retries that differ only in created_at and rpc id', () => {
    expect(requestGroupKey(request())).toBe(requestGroupKey(request()));
  });

  it('separates sign_events with different content, tags, kind, or client', () => {
    const base = requestGroupKey(request());
    const otherContent = request();
    (otherContent.paramsPreview as { event: { content: string } }).event.content = '{"x":1}';
    expect(requestGroupKey(otherContent)).not.toBe(base);

    const otherTags = request();
    (otherTags.paramsPreview as { event: { tags: string[][] } }).event.tags = [['d', 'Other']];
    expect(requestGroupKey(otherTags)).not.toBe(base);

    expect(requestGroupKey(request({ kind: 1 }))).not.toBe(base);
    expect(requestGroupKey(request({ clientPubkey: APP_B }))).not.toBe(base);
  });

  it('groups same-peer decrypts regardless of ciphertext length', () => {
    expect(requestGroupKey(decryptRequest(PEER_X, 52))).toBe(
      requestGroupKey(decryptRequest(PEER_X, 9000))
    );
  });

  it('separates decrypts by peer, method, and client', () => {
    const base = requestGroupKey(decryptRequest(PEER_X, 52));
    expect(requestGroupKey(decryptRequest(PEER_Y, 52))).not.toBe(base);
    expect(requestGroupKey(decryptRequest(PEER_X, 52, APP_B))).not.toBe(base);
    const nip04 = decryptRequest(PEER_X, 52);
    nip04.method = 'nip04_decrypt';
    expect(requestGroupKey(nip04)).not.toBe(base);
  });

  it('normalizes peer case', () => {
    const upper = decryptRequest(PEER_X.toUpperCase(), 10);
    expect(requestGroupKey(upper)).toBe(requestGroupKey(decryptRequest(PEER_X, 10)));
  });

  it('groups encrypts only on identical plaintext', () => {
    const enc = (plaintext: string) =>
      request({
        method: 'nip44_encrypt',
        kind: undefined,
        paramsPreview: { type: 'encrypt', peerPubkey: PEER_X, plaintext },
      });
    expect(requestGroupKey(enc('hi'))).toBe(requestGroupKey(enc('hi')));
    expect(requestGroupKey(enc('hi'))).not.toBe(requestGroupKey(enc('hello')));
  });

  it('never groups none previews', () => {
    const none = () =>
      request({ method: 'get_public_key', kind: undefined, paramsPreview: { type: 'none' } });
    expect(requestGroupKey(none())).not.toBe(requestGroupKey(none()));
  });
});

describe('consolidatePending', () => {
  it('anchors at first occurrence and gathers interleaved members', () => {
    const spamA1 = request();
    const decrypt1 = decryptRequest(PEER_X, 10);
    const spamA2 = request();
    const otherApp = request({ clientPubkey: APP_B });
    const spamA3 = request();

    const groups = consolidatePending([spamA1, decrypt1, spamA2, otherApp, spamA3]);

    expect(groups).toHaveLength(3);
    expect(groups[0].requests.map((r) => r.id)).toEqual([spamA1.id, spamA2.id, spamA3.id]);
    expect(groups[1].requests).toEqual([decrypt1]);
    expect(groups[2].requests).toEqual([otherApp]);
  });

  it('preserves queue order of groups (promote semantics)', () => {
    const decrypt1 = decryptRequest(PEER_X, 10);
    const spam = request();
    const groups = consolidatePending([decrypt1, spam]);
    expect(groups[0].requests[0]).toBe(decrypt1);
  });
});

describe('verdictIdsForGroup', () => {
  const group = { key: 'k', requests: [request(), request(), request()] };

  it('block resolves the head only (engine flushes the rest)', () => {
    expect(verdictIdsForGroup('block', group)).toEqual([group.requests[0].id]);
  });

  it.each(['approve_once', 'always', 'deny_once', 'always_deny'] as const)(
    '%s resolves every member',
    (action) => {
      expect(verdictIdsForGroup(action, group)).toEqual(group.requests.map((r) => r.id));
    }
  );
});

describe('groupDeparted', () => {
  it('classifies expired when none of the ids were resolved', () => {
    expect(groupDeparted(['a', 'b'], new Set())).toBe('expired');
  });

  it('classifies resolved on any overlap', () => {
    expect(groupDeparted(['a', 'b'], new Set(['b']))).toBe('resolved');
    expect(groupDeparted(['a', 'b'], new Set(['a', 'b']))).toBe('resolved');
  });
});
