/**
 * Pins the NIP-46 permission decision tree: the full verdict matrix
 * (class × grant state × mode), kind-5 escalation, decrypt-to-self,
 * the forbidden RPC kind, and the unknown-kind-defaults-sensitive rule.
 * The non-negotiable: critical class never reaches 'allow' from a
 * persisted grant, only from a runtime session grant on a peer≠self decrypt.
 */

import type { ConnectionMode, GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import {
  classifyRequest,
  DENY_ERROR_BY_REASON,
  evaluate,
  grantKeyFor,
  parseGrantKey,
  type ClassifyInput,
  type EvaluateInput,
  type PolicyConnection,
} from '@/features/nostrSigner/lib/permissionPolicy';

const USER_PUBKEY = 'a'.repeat(64);
const PEER_PUBKEY = 'b'.repeat(64);

function makeConnection(overrides: Partial<PolicyConnection> = {}): PolicyConnection {
  return { status: 'active', mode: 'standard', grants: {}, ...overrides };
}

function run(request: ClassifyInput, overrides: Partial<EvaluateInput> = {}) {
  return evaluate({
    connection: makeConnection(),
    request,
    hasSessionGrant: () => false,
    hasSessionAllow: () => false,
    rateLimit: { allowed: true },
    ...overrides,
  });
}

function deletionEvent(tags: string[][]): string {
  return JSON.stringify({ kind: 5, content: '', tags, created_at: 1_700_000_000 });
}

describe('classifyRequest', () => {
  it.each(['ping', 'get_public_key', 'connect'] as const)('classifies %s as auto', (method) => {
    expect(classifyRequest({ method }).class).toBe('auto');
  });

  it.each([1, 6, 16, 7, 1111, 30023])('classifies sign_event kind %i as normal', (kind) => {
    expect(classifyRequest({ method: 'sign_event', kind }).class).toBe('normal');
  });

  it.each([0, 3, 10002, 22242, 27235, 4, 13, 14, 1059, 9734, 30078])(
    'classifies sign_event kind %i as sensitive',
    (kind) => {
      expect(classifyRequest({ method: 'sign_event', kind }).class).toBe('sensitive');
    }
  );

  it.each([17375, 7375, 7374, 7376, 9321, 10019])(
    'classifies sign_event kind %i as critical',
    (kind) => {
      expect(classifyRequest({ method: 'sign_event', kind }).class).toBe('critical');
    }
  );

  it.each([12345, 65535, 20001])('defaults unknown kind %i to sensitive', (kind) => {
    expect(classifyRequest({ method: 'sign_event', kind }).class).toBe('sensitive');
  });

  it('classifies sign_event kind 24133 (NIP-46 RPC itself) as forbidden', () => {
    expect(classifyRequest({ method: 'sign_event', kind: 24133 }).class).toBe('forbidden');
  });

  it.each(['nip04_encrypt', 'nip44_encrypt'] as const)('classifies %s as sensitive', (method) => {
    const result = classifyRequest({ method, params: [PEER_PUBKEY, 'plain'] });
    expect(result.class).toBe('sensitive');
    expect(result.isSelfDecrypt).toBe(false);
  });

  describe('decrypt', () => {
    it.each(['nip04_decrypt', 'nip44_decrypt'] as const)(
      'classifies %s as critical with peer detection',
      (method) => {
        const peer = classifyRequest({
          method,
          params: [PEER_PUBKEY, 'cipher'],
          userPubkey: USER_PUBKEY,
        });
        expect(peer).toEqual({ class: 'critical', isSelfDecrypt: false });

        const self = classifyRequest({
          method,
          params: [USER_PUBKEY, 'cipher'],
          userPubkey: USER_PUBKEY,
        });
        expect(self).toEqual({ class: 'critical', isSelfDecrypt: true });
      }
    );

    it('matches self-decrypt case-insensitively', () => {
      const result = classifyRequest({
        method: 'nip44_decrypt',
        params: [USER_PUBKEY.toUpperCase(), 'cipher'],
        userPubkey: USER_PUBKEY,
      });
      expect(result.isSelfDecrypt).toBe(true);
    });

    it('never flags self-decrypt when userPubkey or the peer param is missing', () => {
      expect(classifyRequest({ method: 'nip44_decrypt', params: [] }).isSelfDecrypt).toBe(false);
      expect(
        classifyRequest({ method: 'nip44_decrypt', userPubkey: USER_PUBKEY }).isSelfDecrypt
      ).toBe(false);
    });
  });

  describe('kind-5 escalation', () => {
    it('stays sensitive when every k tag targets a non-critical kind', () => {
      const params = [
        deletionEvent([
          ['k', '1'],
          ['e', 'c'.repeat(64)],
        ]),
      ];
      expect(classifyRequest({ method: 'sign_event', kind: 5, params }).class).toBe('sensitive');
    });

    it('escalates to critical when any k tag targets a critical kind', () => {
      const params = [
        deletionEvent([
          ['k', '1'],
          ['k', '17375'],
        ]),
      ];
      expect(classifyRequest({ method: 'sign_event', kind: 5, params }).class).toBe('critical');
    });

    it('escalates to critical with no k tag', () => {
      const params = [deletionEvent([['e', 'c'.repeat(64)]])];
      expect(classifyRequest({ method: 'sign_event', kind: 5, params }).class).toBe('critical');
    });

    it('fails closed to critical on missing or unparsable params', () => {
      expect(classifyRequest({ method: 'sign_event', kind: 5 }).class).toBe('critical');
      expect(classifyRequest({ method: 'sign_event', kind: 5, params: ['not json'] }).class).toBe(
        'critical'
      );
    });

    it('fails closed to critical on a non-numeric k tag value', () => {
      const params = [deletionEvent([['k', 'wallet']])];
      expect(classifyRequest({ method: 'sign_event', kind: 5, params }).class).toBe('critical');
    });
  });
});

describe('grantKeyFor', () => {
  it('builds kind-qualified keys for sign_event', () => {
    expect(grantKeyFor('sign_event', 7)).toBe('sign_event:7');
    expect(grantKeyFor('sign_event', 0)).toBe('sign_event:0');
  });

  it('returns the bare method for encryption methods', () => {
    expect(grantKeyFor('nip44_decrypt')).toBe('nip44_decrypt');
    expect(grantKeyFor('nip04_encrypt')).toBe('nip04_encrypt');
  });

  it('returns null for auto methods — wildcard sign_event stays unrepresentable', () => {
    expect(grantKeyFor('ping')).toBeNull();
    expect(grantKeyFor('get_public_key')).toBeNull();
    expect(grantKeyFor('connect')).toBeNull();
    expect(grantKeyFor('sign_event')).toBeNull();
    expect(grantKeyFor('sign_event', 65536)).toBeNull();
    expect(grantKeyFor('sign_event', -1)).toBeNull();
  });
});

describe('parseGrantKey', () => {
  it('is the inverse of grantKeyFor for sign_event kinds', () => {
    expect(parseGrantKey('sign_event:1')).toEqual({ method: 'sign_event', kind: 1 });
    expect(parseGrantKey('sign_event:1111')).toEqual({ method: 'sign_event', kind: 1111 });
    expect(parseGrantKey(grantKeyFor('sign_event', 17375) as GrantKey)).toEqual({
      method: 'sign_event',
      kind: 17375,
    });
  });

  it('returns the bare method (no kind) for encryption keys', () => {
    expect(parseGrantKey('nip44_decrypt')).toEqual({ method: 'nip44_decrypt' });
    expect(parseGrantKey('nip04_encrypt')).toEqual({ method: 'nip04_encrypt' });
  });
});

type Verdict = 'allow' | 'deny' | 'ask';
type GrantState = 'none' | 'always' | 'deny';
const GRANT_STATES = ['none', 'always', 'deny'] as const;
const MODES = ['standard', 'strict'] as const;

interface MatrixCase {
  label: string;
  request: ClassifyInput;
  grantKey: GrantKey;
  expected: Record<GrantState, Record<ConnectionMode, Verdict>>;
}

const STANDARD_GRANTABLE: MatrixCase['expected'] = {
  none: { standard: 'ask', strict: 'ask' },
  always: { standard: 'allow', strict: 'ask' },
  deny: { standard: 'deny', strict: 'deny' },
};

const CRITICAL_CEILING: MatrixCase['expected'] = {
  none: { standard: 'ask', strict: 'ask' },
  always: { standard: 'ask', strict: 'ask' },
  deny: { standard: 'deny', strict: 'deny' },
};

const MATRIX: MatrixCase[] = [
  {
    label: 'auto (ping)',
    request: { method: 'ping' },
    // ping has no grant key; seeded grants must never affect it
    grantKey: 'sign_event:1',
    expected: {
      none: { standard: 'allow', strict: 'allow' },
      always: { standard: 'allow', strict: 'allow' },
      deny: { standard: 'allow', strict: 'allow' },
    },
  },
  {
    label: 'normal (sign_event kind 1)',
    request: { method: 'sign_event', kind: 1 },
    grantKey: 'sign_event:1',
    expected: STANDARD_GRANTABLE,
  },
  {
    label: 'sensitive (sign_event kind 0)',
    request: { method: 'sign_event', kind: 0 },
    grantKey: 'sign_event:0',
    expected: STANDARD_GRANTABLE,
  },
  {
    label: 'sensitive (unknown kind 12345)',
    request: { method: 'sign_event', kind: 12345 },
    grantKey: 'sign_event:12345',
    expected: STANDARD_GRANTABLE,
  },
  {
    label: 'sensitive (nip44_encrypt)',
    request: { method: 'nip44_encrypt', params: [PEER_PUBKEY, 'plain'] },
    grantKey: 'nip44_encrypt',
    expected: STANDARD_GRANTABLE,
  },
  {
    label: 'critical (sign_event kind 17375)',
    request: { method: 'sign_event', kind: 17375 },
    grantKey: 'sign_event:17375',
    expected: CRITICAL_CEILING,
  },
  {
    label: 'critical (nip44_decrypt, peer)',
    request: { method: 'nip44_decrypt', params: [PEER_PUBKEY, 'cipher'], userPubkey: USER_PUBKEY },
    grantKey: 'nip44_decrypt',
    expected: CRITICAL_CEILING,
  },
  {
    label: 'forbidden (sign_event kind 24133)',
    request: { method: 'sign_event', kind: 24133 },
    grantKey: 'sign_event:24133',
    expected: {
      none: { standard: 'deny', strict: 'deny' },
      always: { standard: 'deny', strict: 'deny' },
      deny: { standard: 'deny', strict: 'deny' },
    },
  },
];

describe('evaluate verdict matrix', () => {
  for (const matrixCase of MATRIX) {
    for (const grantState of GRANT_STATES) {
      for (const mode of MODES) {
        const expected = matrixCase.expected[grantState][mode];
        it(`${matrixCase.label} · grant=${grantState} · mode=${mode} → ${expected}`, () => {
          const grants =
            grantState === 'none' ? {} : { [matrixCase.grantKey]: { verdict: grantState } };
          const decision = run(matrixCase.request, {
            connection: makeConnection({ mode, grants }),
          });
          expect(decision.verdict).toBe(expected);
        });
      }
    }
  }
});

describe('evaluate decisions', () => {
  it('denies unknown senders with Not authorized', () => {
    const decision = run({ method: 'sign_event', kind: 1 }, { connection: null });
    expect(decision).toMatchObject({
      verdict: 'deny',
      reason: 'not_connected',
      logVerdict: 'auto_denied_unauthorized',
    });
    expect(DENY_ERROR_BY_REASON.not_connected).toBe('Not authorized');
  });

  it('denies blocked apps even with an always grant', () => {
    const decision = run(
      { method: 'sign_event', kind: 1 },
      {
        connection: makeConnection({
          status: 'blocked',
          grants: { 'sign_event:1': { verdict: 'always' } },
        }),
      }
    );
    expect(decision).toMatchObject({
      verdict: 'deny',
      reason: 'blocked',
      logVerdict: 'auto_denied_blocked',
    });
  });

  it('denies rate-limited requests, including auto methods', () => {
    const decision = run({ method: 'ping' }, { rateLimit: { allowed: false } });
    expect(decision).toMatchObject({
      verdict: 'deny',
      reason: 'rate_limited',
      logVerdict: 'auto_denied_rate_limited',
    });
    expect(DENY_ERROR_BY_REASON.rate_limited).toBe('rate limited');
  });

  it('silently denies the forbidden kind with no grant key attached', () => {
    const decision = run({ method: 'sign_event', kind: 24133 });
    expect(decision).toMatchObject({
      verdict: 'deny',
      reason: 'forbidden_kind',
      logVerdict: 'auto_denied_forbidden',
      class: 'forbidden',
    });
    expect(decision.grantKey).toBeUndefined();
    expect(DENY_ERROR_BY_REASON.forbidden_kind).toBe('Not authorized');
  });

  it('allows auto methods without a grant key, even in strict mode', () => {
    const decision = run(
      { method: 'get_public_key' },
      {
        connection: makeConnection({ mode: 'strict' }),
      }
    );
    expect(decision).toMatchObject({
      verdict: 'allow',
      reason: 'auto_method',
      logVerdict: 'auto_approved_method',
      class: 'auto',
    });
    expect(decision.grantKey).toBeUndefined();
  });

  it('acks a duplicate connect from a paired app', () => {
    expect(run({ method: 'connect' }).verdict).toBe('allow');
  });

  it('denies sign_event without a kind as malformed', () => {
    const decision = run({ method: 'sign_event' });
    expect(decision).toMatchObject({
      verdict: 'deny',
      reason: 'malformed',
      logVerdict: 'auto_denied_malformed',
    });
    expect(DENY_ERROR_BY_REASON.malformed).toBe('malformed request');
  });

  it('returns the grant key on ask so the prompt can persist a verdict', () => {
    const decision = run({ method: 'sign_event', kind: 1 });
    expect(decision).toMatchObject({
      verdict: 'ask',
      reason: 'no_grant',
      grantKey: 'sign_event:1',
    });
  });

  it('labels allow-from-grant and deny-from-grant log verdicts', () => {
    const allowed = run(
      { method: 'sign_event', kind: 1 },
      { connection: makeConnection({ grants: { 'sign_event:1': { verdict: 'always' } } }) }
    );
    expect(allowed).toMatchObject({ reason: 'grant_always', logVerdict: 'auto_approved_grant' });

    const denied = run(
      { method: 'sign_event', kind: 1 },
      { connection: makeConnection({ grants: { 'sign_event:1': { verdict: 'deny' } } }) }
    );
    expect(denied).toMatchObject({ reason: 'grant_deny', logVerdict: 'auto_denied_grant' });
  });

  it('asks with critical_class when a tampered always grant targets a critical key', () => {
    const decision = run(
      { method: 'sign_event', kind: 17375 },
      { connection: makeConnection({ grants: { 'sign_event:17375': { verdict: 'always' } } }) }
    );
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'critical_class' });
  });

  it('asks with strict_mode reason in strict mode', () => {
    const decision = run(
      { method: 'sign_event', kind: 1 },
      {
        connection: makeConnection({ mode: 'strict' }),
      }
    );
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'strict_mode' });
  });
});

describe('session grants', () => {
  const peerDecrypt: ClassifyInput = {
    method: 'nip44_decrypt',
    params: [PEER_PUBKEY, 'cipher'],
    userPubkey: USER_PUBKEY,
  };
  const selfDecrypt: ClassifyInput = {
    method: 'nip44_decrypt',
    params: [USER_PUBKEY, 'cipher'],
    userPubkey: USER_PUBKEY,
  };

  it('allows a peer≠self decrypt holding a session grant for THAT peer', () => {
    const decision = run(peerDecrypt, {
      hasSessionGrant: (key, peer) => key === 'nip44_decrypt' && peer === PEER_PUBKEY,
    });
    expect(decision).toMatchObject({
      verdict: 'allow',
      reason: 'session_grant',
      logVerdict: 'auto_approved_session',
      class: 'critical',
      peerPubkey: PEER_PUBKEY,
    });
  });

  it('asks when the session grant belongs to a different peer', () => {
    const decision = run(peerDecrypt, {
      hasSessionGrant: (key, peer) => key === 'nip44_decrypt' && peer === 'c'.repeat(64),
    });
    expect(decision).toMatchObject({ verdict: 'ask' });
  });

  it('still prompts for decrypt-to-self despite a session grant', () => {
    const decision = run(selfDecrypt, { hasSessionGrant: () => true });
    expect(decision).toMatchObject({
      verdict: 'ask',
      reason: 'self_decrypt',
      isSelfDecrypt: true,
    });
  });

  it('ignores session grants in strict mode', () => {
    const decision = run(peerDecrypt, {
      connection: makeConnection({ mode: 'strict' }),
      hasSessionGrant: () => true,
    });
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'strict_mode' });
  });

  it('never applies session grants to signing requests', () => {
    const decision = run({ method: 'sign_event', kind: 17375 }, { hasSessionGrant: () => true });
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'critical_class' });
  });

  it('honors a deny grant before any session grant', () => {
    const decision = run(peerDecrypt, {
      connection: makeConnection({ grants: { nip44_decrypt: { verdict: 'deny' } } }),
      hasSessionGrant: () => true,
    });
    expect(decision).toMatchObject({ verdict: 'deny', reason: 'grant_deny' });
  });
});

describe('per-peer persistent decrypt grants', () => {
  const peerDecrypt: ClassifyInput = {
    method: 'nip44_decrypt',
    params: [PEER_PUBKEY, 'cipher'],
    userPubkey: USER_PUBKEY,
  };

  function withPeerGrant(methods: string[], peer: string = PEER_PUBKEY): PolicyConnection {
    return makeConnection({ peerDecryptGrants: { [peer]: { methods } } });
  }

  it('allows a decrypt holding a matching (peer, method) grant', () => {
    const decision = run(peerDecrypt, { connection: withPeerGrant(['nip44_decrypt']) });
    expect(decision).toMatchObject({
      verdict: 'allow',
      reason: 'peer_grant_always',
      logVerdict: 'auto_approved_peer_grant',
      class: 'critical',
      peerPubkey: PEER_PUBKEY,
    });
  });

  it('asks when the grant covers a different peer', () => {
    const decision = run(peerDecrypt, {
      connection: withPeerGrant(['nip44_decrypt'], 'c'.repeat(64)),
    });
    expect(decision).toMatchObject({ verdict: 'ask' });
  });

  it('asks when the grant covers a different decrypt method', () => {
    const decision = run(peerDecrypt, { connection: withPeerGrant(['nip04_decrypt']) });
    expect(decision).toMatchObject({ verdict: 'ask' });
  });

  it('matches uppercase request params against a lowercase grant key', () => {
    const decision = run(
      { ...peerDecrypt, params: [PEER_PUBKEY.toUpperCase(), 'cipher'] },
      { connection: withPeerGrant(['nip44_decrypt']) }
    );
    expect(decision).toMatchObject({ verdict: 'allow', reason: 'peer_grant_always' });
  });

  it('still prompts for decrypt-to-self even with a poisoned matching entry', () => {
    const decision = run(
      { method: 'nip44_decrypt', params: [USER_PUBKEY, 'cipher'], userPubkey: USER_PUBKEY },
      { connection: withPeerGrant(['nip44_decrypt'], USER_PUBKEY) }
    );
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'self_decrypt', isSelfDecrypt: true });
  });

  it('ignores peer grants in strict mode', () => {
    const decision = run(peerDecrypt, {
      connection: makeConnection({
        mode: 'strict',
        peerDecryptGrants: { [PEER_PUBKEY]: { methods: ['nip44_decrypt'] } },
      }),
    });
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'strict_mode' });
  });

  it('honors a blanket deny grant over a peer grant', () => {
    const decision = run(peerDecrypt, {
      connection: makeConnection({
        grants: { nip44_decrypt: { verdict: 'deny' } },
        peerDecryptGrants: { [PEER_PUBKEY]: { methods: ['nip44_decrypt'] } },
      }),
    });
    expect(decision).toMatchObject({ verdict: 'deny', reason: 'grant_deny' });
  });

  it('a tampered blanket decrypt-always still asks (critical ceiling intact)', () => {
    const decision = run(peerDecrypt, {
      connection: makeConnection({ grants: { nip44_decrypt: { verdict: 'always' } } }),
    });
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'critical_class' });
  });

  it('never applies peer grants to signing requests', () => {
    const decision = run(
      { method: 'sign_event', kind: 1, params: [PEER_PUBKEY], userPubkey: USER_PUBKEY },
      { connection: withPeerGrant(['nip44_decrypt']) }
    );
    expect(decision).toMatchObject({ verdict: 'ask' });
  });
});

describe('session allows', () => {
  it('allows a sign request holding a session allow', () => {
    const decision = run(
      { method: 'sign_event', kind: 1 },
      { hasSessionAllow: (grantKey) => grantKey === 'sign_event:1' }
    );
    expect(decision).toMatchObject({
      verdict: 'allow',
      reason: 'session_allow',
      logVerdict: 'auto_approved_session',
    });
  });

  it('allows a CRITICAL wallet sign kind via session allow — runtime-only bypass of the persisted ceiling', () => {
    const decision = run({ method: 'sign_event', kind: 17375 }, { hasSessionAllow: () => true });
    expect(decision).toMatchObject({
      verdict: 'allow',
      reason: 'session_allow',
      logVerdict: 'auto_approved_session',
    });
  });

  it('ignores session allows in strict mode', () => {
    const decision = run(
      { method: 'sign_event', kind: 1 },
      { connection: makeConnection({ mode: 'strict' }), hasSessionAllow: () => true }
    );
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'strict_mode' });
  });

  it('honors a deny grant before any session allow', () => {
    const decision = run(
      { method: 'sign_event', kind: 1 },
      {
        connection: makeConnection({ grants: { 'sign_event:1': { verdict: 'deny' } } }),
        hasSessionAllow: () => true,
      }
    );
    expect(decision).toMatchObject({ verdict: 'deny', reason: 'grant_deny' });
  });

  it('never applies session allows to a self-decrypt', () => {
    const decision = run(
      { method: 'nip44_decrypt', params: [USER_PUBKEY, 'ct'], userPubkey: USER_PUBKEY },
      { hasSessionAllow: () => true }
    );
    expect(decision).toMatchObject({ verdict: 'ask', reason: 'self_decrypt' });
  });
});
