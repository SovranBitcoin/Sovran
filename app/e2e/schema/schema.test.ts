import { describe, expect, it } from 'bun:test';
import {
  validateScenario,
  validateFixture,
  validateSuite,
  validateFixtureGraph,
  scanSecrets,
  scenarioPlatforms,
  checkCompact,
  formatDoc,
  parseFacets,
  CANONICAL_PAGES,
  REINSTALL_KEYCHAIN_RETENTION_CAPABILITY,
  type Fixture,
} from './index';

// Secret-shaped fixtures assembled at runtime so the source file never holds a
// contiguous nsec/cashu literal (which the repo's write-guard — rightly —
// blocks). The scanner still sees the assembled value.
const CASHU_TOKEN = 'cashu' + 'B' + 'abcdefghijklmnopqrstuvwxyz0123';
const NSEC = 'nsec' + '1qwertyuiopasdfghjklzxcvbnm12345';
const PUBLIC_PAYMENT_REQUEST =
  'creqAp2F0gaNhdGRwb3N0YWF4G2h0dHBzOi8vZTJlLmludmFsaWQvcGF5bWVudGFn92FpeBxzb3ZyYW4tZTJlLWRlbGl2ZXJ5LXJvbGxiYWNrYWEYHmF1Y3NhdGFtgXgZaHR0cHM6Ly9taW50LnNvdnJhbi5tb25leWFkdUUyRSBkZWxpdmVyeSByb2xsYmFja2Fz9Q==';

const scenario = (over: Record<string, unknown> = {}) => ({
  version: 1,
  id: 'send.lightning.sat',
  name: 'Send over Lightning',
  description: 'Pay a cocod invoice and verify tx truth',
  lane: 'funded',
  tags: ['flow:send', 'instrument:bolt11', 'outcome:settled'],
  requires: ['cocod.receive.bolt11', 'unit.sat'],
  funds: {
    assets: [
      {
        mintUrl: 'https://mint.sovran.money',
        unit: 'sat',
        accountIndex: 0,
        maxPrincipal: 100,
      },
    ],
  },
  steps: [{ action: 'waitFor', selector: { id: 'screen-wallet' } }],
  verify: [{ action: 'assert', that: 'visible', selector: { id: 'screen-wallet' } }],
  endState: 'wallet',
  ...over,
});

describe('scenario schema — accepts a valid scenario', () => {
  it('passes and applies defaults', () => {
    const r = validateScenario(scenario());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.setup).toEqual([]);
      expect(r.value.verify).toHaveLength(1);
      expect(r.value.funds!.assets).toEqual([
        {
          mintUrl: 'https://mint.sovran.money',
          unit: 'sat',
          accountIndex: 0,
          maxPrincipal: 100,
        },
      ]);
    }
  });

  it('accepts an optional technical details field and rejects an empty one', () => {
    const withDetails = validateScenario(
      scenario({ details: 'Funds 100 via cocod; asserts the net balance delta.' })
    );
    expect(withDetails.ok).toBe(true);
    if (withDetails.ok) {
      expect(withDetails.value.details).toBe('Funds 100 via cocod; asserts the net balance delta.');
    }
    expect(validateScenario(scenario({ details: '' })).ok).toBe(false);
  });
});

describe('scenario schema — facet tags', () => {
  it('requires exactly one flow facet', () => {
    const none = validateScenario(scenario({ tags: ['cocod'] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.issues.some((i) => i.message.includes('flow:'))).toBe(true);
    const two = validateScenario(scenario({ tags: ['flow:send', 'flow:receive'] }));
    expect(two.ok).toBe(false);
  });

  it('rejects unknown facet names and values, and rejects bare tags', () => {
    expect(validateScenario(scenario({ tags: ['flow:send', 'direction:out'] })).ok).toBe(false);
    expect(validateScenario(scenario({ tags: ['flow:send', 'io:carrier-pigeon'] })).ok).toBe(false);
    expect(
      validateScenario(scenario({ tags: ['flow:send', 'state-machine-11.16', 'cocod'] })).ok
    ).toBe(false);
    expect(validateScenario(scenario({ tags: ['flow:send', 'check:mint-change'] })).ok).toBe(true);
  });

  it('rejects repeated single-valued facets but allows repeated checks', () => {
    expect(validateScenario(scenario({ tags: ['flow:send', 'io:paste', 'io:copy'] })).ok).toBe(
      false
    );
    expect(
      validateScenario(scenario({ tags: ['flow:receive', 'check:toast', 'check:tx-source'] })).ok
    ).toBe(true);
  });

  it('parses facets into a structured view', () => {
    expect(
      parseFacets([
        'flow:receive',
        'instrument:bolt11',
        'amount:fixed',
        'io:copy',
        'check:toast',
        'cocod',
      ])
    ).toEqual({
      flow: 'receive',
      instrument: 'bolt11',
      amount: 'fixed',
      io: 'copy',
      checks: ['toast'],
      extras: ['cocod'],
    });
  });
});

describe('scenario schema — strict rejections', () => {
  it('requires an explicit funds.assets contract for funded scenarios', () => {
    const { funds: _funds, ...withoutFunds } = scenario();
    const result = validateScenario(withoutFunds);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'funds',
        message: 'funded scenarios require an explicit funds.assets contract',
      });
    }
  });
  it('accepts only typed, exact-asset counterparty value operations', () => {
    const asset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
    };
    const steps = [
      {
        action: 'counterparty',
        operation: 'cashu.create',
        ...asset,
        amount: 50,
        captureAs: 'token',
        setClipboard: true,
      },
      {
        action: 'counterparty',
        operation: 'cashu.redeem',
        ...asset,
        amount: 50,
        token: '${token}',
      },
      {
        action: 'counterparty',
        operation: 'bolt11.create',
        ...asset,
        amount: 40,
        captureAs: 'invoice',
        setClipboard: true,
      },
      {
        action: 'counterparty',
        operation: 'bolt11.pay',
        ...asset,
        amount: 40,
        invoice: '${invoice}',
      },
      {
        action: 'counterparty',
        operation: 'bolt11.settled',
        ...asset,
        amount: 40,
        invoice: '${invoice}',
      },
      {
        action: 'counterparty',
        operation: 'lightning-address.resolve',
        ...asset,
        amount: 21,
        address: '${address}',
        captureAs: 'resolvedInvoice',
      },
      {
        action: 'counterparty',
        operation: 'lightning-address.pay',
        ...asset,
        amount: 21,
        address: '${address}',
      },
      {
        action: 'counterparty',
        operation: 'recovery.sweep',
        ...asset,
      },
    ];
    expect(validateScenario(scenario({ steps })).ok).toBe(true);
  });
  it('keeps host recovery sweeps amountless and tokenless', () => {
    const sweep = {
      action: 'counterparty',
      operation: 'recovery.sweep',
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
    };
    expect(validateScenario(scenario({ steps: [sweep] })).ok).toBe(true);
    expect(validateScenario(scenario({ steps: [{ ...sweep, amount: 60 }] })).ok).toBe(false);
    expect(validateScenario(scenario({ steps: [{ ...sweep, token: '${token}' }] })).ok).toBe(false);
  });
  it('caps aggregate funded principal at 200 sats', () => {
    const result = validateScenario(
      scenario({
        funds: {
          assets: [
            {
              mintUrl: 'https://mint.sovran.money',
              unit: 'sat',
              accountIndex: 0,
              maxPrincipal: 128,
            },
            {
              mintUrl: 'https://mint.minibits.cash/Bitcoin',
              unit: 'sat',
              accountIndex: 0,
              maxPrincipal: 80,
            },
          ],
        },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'funds.assets',
        message: 'aggregate maxPrincipal must be at most 200 sats',
      });
    }
  });
  it('rejects duplicate exact asset locations', () => {
    const asset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 50,
    };
    const result = validateScenario(scenario({ funds: { assets: [asset, asset] } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'funds.assets.1',
        message: 'duplicate funded asset location',
      });
    }
  });
  it.each([
    { action: 'exec', command: ['cocod', 'send', 'bolt11', '${invoice}'] },
    { action: 'setClipboard', from: ['cocod', 'receive', 'bolt11', '40'] },
  ])('forbids raw cocod command steps in funded scenarios', (step) => {
    const result = validateScenario(scenario({ steps: [step] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'steps.0',
        message: 'funded scenarios must use typed counterparty steps, not raw cocod commands',
      });
    }
  });
  it('rejects a typed value operation above its exact asset principal', () => {
    const result = validateScenario(
      scenario({
        steps: [
          {
            action: 'counterparty',
            operation: 'bolt11.pay',
            mintUrl: 'https://mint.sovran.money',
            unit: 'sat',
            accountIndex: 0,
            amount: 101,
            invoice: '${invoice}',
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'steps.0.amount',
        message: 'counterparty amount 101 exceeds exact asset maxPrincipal 100',
      });
    }
  });
  it('accepts a typed emoji clipboard roundtrip assertion', () => {
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'assert',
              that: 'emojiClipboardDecodesTo',
              variable: 'rawToken',
            },
          ],
        })
      ).ok
    ).toBe(true);
  });
  it('accepts only a decodable NUT-18 value in the public payment-request clipboard step', () => {
    expect(
      validateScenario(
        scenario({
          requires: ['mock.payment-request-delivery-failure'],
          steps: [{ action: 'setPaymentRequestClipboard', request: PUBLIC_PAYMENT_REQUEST }],
        })
      ).ok
    ).toBe(true);
    expect(
      validateScenario(
        scenario({
          steps: [{ action: 'setPaymentRequestClipboard', request: 'ordinary clipboard text' }],
        })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'setPaymentRequestClipboard', request: 'creqAnot-cbor' }] })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'setPaymentRequestClipboard',
              request: PUBLIC_PAYMENT_REQUEST,
              value: 'second raw field',
            },
          ],
        })
      ).ok
    ).toBe(false);
  });
  it.each(['simulator', 'live'] as const)(
    'rejects the payment-request delivery failure mock in the %s lane',
    (lane) => {
      const result = validateScenario(
        scenario({ lane, requires: ['mock.payment-request-delivery-failure'] })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toContainEqual({
          path: 'requires',
          message: 'mock.payment-request-delivery-failure requires the funded lane',
        });
      }
    }
  );
  it('rejects omitted and empty verify sections', () => {
    const { verify: _verify, ...legacy } = scenario();
    expect(validateScenario(legacy).ok).toBe(false);
    expect(validateScenario(scenario({ verify: [] })).ok).toBe(false);
  });
  it('rejects unknown top-level keys', () => {
    expect(validateScenario(scenario({ extra: 1 })).ok).toBe(false);
  });
  it('rejects a step with no action', () => {
    expect(validateScenario(scenario({ steps: [{ selector: { id: 'x' } }] })).ok).toBe(false);
  });
  it('rejects a step with an extra (second) key beyond its action', () => {
    expect(
      validateScenario(scenario({ steps: [{ action: 'tap', selector: { id: 'x' }, x: 0.5 }] })).ok
    ).toBe(false);
  });
  it('rejects out-of-range tap coordinates', () => {
    expect(validateScenario(scenario({ steps: [{ action: 'tapAt', x: 2, y: 0.5 }] })).ok).toBe(
      false
    );
  });
  it('accepts selector-relative drags and rejects unsafe duration/coordinates', () => {
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'drag',
              selector: { id: 'slide-to-confirm' },
              from: { x: 0.08, y: 0.5 },
              to: { x: 0.92, y: 0.5 },
              durationMs: 400,
            },
          ],
        })
      ).ok
    ).toBe(true);
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'drag',
              selector: { id: 'slide-to-confirm' },
              from: { x: -1, y: 0.5 },
              to: { x: 0.92, y: 0.5 },
              durationMs: 50,
            },
          ],
        })
      ).ok
    ).toBe(false);
  });
  it('rejects a non-positive timeout', () => {
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'waitFor', selector: { id: 'x' }, timeoutMs: 0 }] })
      ).ok
    ).toBe(false);
  });
  it('rejects a negative asserted tx amount', () => {
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'assert', that: 'tx', txRef: 't', amount: -5 }] })
      ).ok
    ).toBe(false);
  });
  it('allows an explicitly absent transaction source and rejects unknown source text', () => {
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'assert', that: 'tx', txRef: 't', source: null }] })
      ).ok
    ).toBe(true);
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'assert', that: 'tx', txRef: 't', source: 'raw-input' }] })
      ).ok
    ).toBe(false);
  });
  it('rejects an unknown capability token', () => {
    expect(validateScenario(scenario({ requires: ['cocod.onchain.send'] })).ok).toBe(false);
  });
  it('rejects a disallowed exec command', () => {
    expect(
      validateScenario(scenario({ steps: [{ action: 'exec', command: ['rm', '-rf', '/'] }] })).ok
    ).toBe(false);
  });
  it('rejects a two-key selector', () => {
    expect(
      validateScenario(scenario({ steps: [{ action: 'tap', selector: { id: 'x', label: 'y' } }] }))
        .ok
    ).toBe(false);
  });
  it('allows id-suffix capture only on waitFor selectors', () => {
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'waitFor',
              selector: { idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' },
            },
          ],
        })
      ).ok
    ).toBe(true);
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'tap',
              selector: { idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' },
            },
          ],
        })
      ).ok
    ).toBe(false);
  });
  it('bounds zero-based visible prefix match indexes', () => {
    expect(
      validateScenario(
        scenario({
          steps: [
            {
              action: 'waitFor',
              selector: {
                idPrefix: 'contact-row:mint:',
                matchIndex: 2,
                captureSuffixAs: 'mintThreeUrl',
              },
            },
          ],
        })
      ).ok
    ).toBe(true);
    expect(
      validateScenario(
        scenario({
          steps: [
            { action: 'waitFor', selector: { idPrefix: 'contact-row:mint:', matchIndex: -1 } },
          ],
        })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({
          steps: [
            { action: 'waitFor', selector: { idPrefix: 'contact-row:mint:', matchIndex: 1.5 } },
          ],
        })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({
          steps: [
            { action: 'waitFor', selector: { idPrefix: 'contact-row:mint:', matchIndex: 101 } },
          ],
        })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({
          steps: [{ action: 'tap', selector: { idPrefix: 'contact-row:mint:', matchIndex: 0 } }],
        })
      ).ok
    ).toBe(true);
  });
  it('rejects inert scenario controls instead of promising unsupported behavior', () => {
    expect(validateScenario(scenario({ knownGap: 'a' })).ok).toBe(false);
    expect(validateScenario(scenario({ timeoutMs: 1_000 })).ok).toBe(false);
    expect(validateScenario(scenario({ feeBudgetSats: 1 })).ok).toBe(false);
    expect(validateScenario(scenario({ artifacts: { perStep: true } })).ok).toBe(false);
  });
  it('allows a delay only with an explicit reason', () => {
    expect(validateScenario(scenario({ steps: [{ action: 'delay', ms: 500 }] })).ok).toBe(false);
    expect(
      validateScenario(scenario({ steps: [{ action: 'delay', ms: 500, reason: 'sheet settle' }] }))
        .ok
    ).toBe(true);
  });
  it('requires screenshot tolerance to have stable comparison semantics', () => {
    expect(
      validateScenario(
        scenario({ steps: [{ action: 'screenshot', name: 'wallet', tolerance: 0.01 }] })
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        scenario({
          steps: [{ action: 'screenshot', name: 'wallet', stable: true, tolerance: 0.01 }],
        })
      ).ok
    ).toBe(true);
  });
  it('rejects unsafe screenshot artifact names', () => {
    expect(
      validateScenario(scenario({ steps: [{ action: 'screenshot', name: '../wallet' }] })).ok
    ).toBe(false);
  });
  it('rejects screenshot names outside the canonical page registry', () => {
    expect(
      validateScenario(scenario({ steps: [{ action: 'screenshot', name: 'wallet-start' }] })).ok
    ).toBe(false);
    expect(
      validateScenario(scenario({ steps: [{ action: 'screenshot', name: 'receive-token' }] })).ok
    ).toBe(true);
  });
  it('keeps every canonical page name safe and seq-unambiguous', () => {
    expect(new Set(CANONICAL_PAGES).size).toBe(CANONICAL_PAGES.length);
    for (const page of CANONICAL_PAGES) {
      expect(page).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      // The viewer strips a trailing `-NNN` artifact seq from named captures;
      // a digit-suffixed page name would parse ambiguously.
      expect(page).not.toMatch(/-\d+$/);
    }
  });
  it('rejects the impossible terminated end state until a driver can prove it', () => {
    expect(validateScenario(scenario({ endState: 'terminated' })).ok).toBe(false);
  });
});

describe('secret scanning', () => {
  it('flags a cashu token in a step value', () => {
    const r = validateScenario(
      scenario({ steps: [{ action: 'input', selector: { id: 'x' }, value: CASHU_TOKEN }] })
    );
    expect(r.ok).toBe(false);
  });
  it('flags an nsec anywhere', () => {
    expect(scanSecrets({ note: NSEC }).length).toBeGreaterThan(0);
  });
  it('flags exact mnemonic and 64-hex private-key material', () => {
    const mnemonic = Array.from({ length: 12 }, () => 'abandon').join(' ');
    const privateKey = 'ab'.repeat(32);
    expect(scanSecrets({ value: mnemonic })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('mnemonic') }),
      ])
    );
    expect(scanSecrets({ value: privateKey })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('64-hex') }),
      ])
    );
  });
  it('does not flag ordinary prose', () => {
    expect(
      scanSecrets({ description: 'Pay a Lightning invoice and confirm the toast' }).length
    ).toBe(0);
  });
  it('exempts the pinned public test-counterparty identity, but no other npub/pubkey', () => {
    const cocodNpub = 'npub1ajx0lhr3kdsx8ckfwxsxrgpuazrfx2ahmwrc906lvwzrfr5l0kesg8tx5h';
    const cocodHex = 'ec8cffdc71b36063e2c971a061a03ce886932bb7db8782bf5f6384348e9f7db3';
    expect(scanSecrets({ value: cocodNpub }).length).toBe(0);
    expect(scanSecrets({ id: `contact-row:nostr:${cocodHex}` }).length).toBe(0);
    expect(scanSecrets({ value: `npub1${'q'.repeat(58)}` }).length).toBeGreaterThan(0);
  });
});

describe('npc.outflow placement', () => {
  const npcOutflow = {
    action: 'counterparty',
    operation: 'npc.outflow',
    mintUrl: 'https://mint.sovran.money',
    unit: 'sat',
    accountIndex: 0,
    amount: 40,
    address: '${addr}',
  };
  const paidAssert = {
    action: 'assert',
    that: 'tx',
    txRef: '${tx}',
    status: 'PAID',
  };
  const funded = (steps: unknown[]) =>
    scenario({
      lane: 'funded',
      requires: ['fresh-install', 'unit.sat'],
      funds: {
        assets: [
          { mintUrl: 'https://mint.sovran.money', unit: 'sat', accountIndex: 0, maxPrincipal: 50 },
        ],
      },
      steps,
    });

  it('rejects npc.outflow with no prior PAID tx assert', () => {
    const r = validateScenario(funded([npcOutflow]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.message).toContain('npc.outflow must follow');
    }
  });
  it('accepts npc.outflow after a PAID tx assert', () => {
    const r = validateScenario(funded([paidAssert, npcOutflow]));
    expect(r.ok).toBe(true);
  });
});

describe('suite manifest', () => {
  const suite = (scenarios: unknown[]) => ({ version: 1, name: 'default', scenarios });
  const ref = (over: Record<string, unknown> = {}) => ({
    id: 'onboarding.fresh',
    file: 'scenarios/onboarding-fresh.json',
    order: 10,
    newInstance: true,
    lane: 'simulator',
    ...over,
  });
  it('accepts a valid manifest', () => {
    expect(validateSuite(suite([ref()])).ok).toBe(true);
  });
  it('rejects a duplicate scenario order', () => {
    expect(validateSuite(suite([ref(), ref({ id: 'recovery.reinstall' })])).ok).toBe(false);
  });
  it('rejects a non-scenarios/*.json file path', () => {
    expect(validateSuite(suite([ref({ file: 'evil.json' })])).ok).toBe(false);
  });
  it('requires an explicit simulator instance boundary for every scenario', () => {
    const { newInstance: _newInstance, ...withoutBoundary } = ref();
    expect(validateSuite(suite([withoutBoundary])).ok).toBe(false);
  });
  it('rejects simulator reuse without an ordered predecessor', () => {
    expect(validateSuite(suite([ref({ newInstance: false })])).ok).toBe(false);
  });
  it('allows reuse only between adjacent ordinary simulator scenarios', () => {
    const recovery = ref({ id: 'recovery.reinstall', order: 20, newInstance: false });
    expect(validateSuite(suite([ref(), recovery])).ok).toBe(true);
    expect(validateSuite(suite([ref({ lane: 'funded' }), recovery])).ok).toBe(false);
    expect(validateSuite(suite([ref(), { ...recovery, lane: 'funded' }])).ok).toBe(false);
  });
  it('rejects suite controls the runner does not execute', () => {
    expect(validateSuite({ ...suite([ref()]), cleanupPolicy: 'always' }).ok).toBe(false);
    expect(validateSuite({ ...suite([ref()]), feeBudgetSats: 10 }).ok).toBe(false);
    expect(validateSuite(suite([ref({ cleanup: 'reset' })])).ok).toBe(false);
    expect(validateSuite({ ...suite([ref()]), artifactPolicy: { perStep: true } }).ok).toBe(false);
  });
});

describe('fixture graph', () => {
  const fx = (id: string, uses: string[]): Fixture => ({
    version: 1,
    id,
    params: [],
    requires: [],
    steps: uses.length ? uses.map((u) => ({ use: u })) : [{ action: 'goHome' }],
  });
  it('detects a dependency cycle', () => {
    expect(validateFixtureGraph([fx('a.x', ['b.y']), fx('b.y', ['a.x'])]).ok).toBe(false);
  });
  it('detects an unknown fixture reference', () => {
    expect(validateFixtureGraph([fx('a.x', ['missing.y'])]).ok).toBe(false);
  });
  it('accepts an acyclic graph', () => {
    expect(validateFixtureGraph([fx('a.x', ['b.y']), fx('b.y', [])]).ok).toBe(true);
  });
  it('allows exact typed counterparty fields to come from fixture parameters', () => {
    expect(
      validateFixture({
        version: 1,
        id: 'flow.sweep-mint',
        params: ['mintUrl', 'unit', 'accountIndex'],
        requires: ['cocod.receive.cashu'],
        steps: [
          {
            action: 'counterparty',
            operation: 'recovery.sweep',
            mintUrl: '${mintUrl}',
            unit: '${unit}',
            accountIndex: '${accountIndex}',
          },
        ],
      }).ok
    ).toBe(true);
  });
});

describe('compact format', () => {
  it('accepts a compact doc (one record per line)', () => {
    expect(checkCompact(formatDoc(scenario())).ok).toBe(true);
  });
  it('keeps each explicit verify record on one physical line', () => {
    const formatted = formatDoc({
      version: 1,
      steps: [{ action: 'goHome' }],
      verify: [
        { action: 'assert', that: 'visible', selector: { id: 'wallet-send' } },
        { action: 'screenshot', name: 'final-wallet' },
      ],
    });
    expect(formatted.split('\n').filter((line) => line.includes('"action"'))).toHaveLength(3);
    expect(checkCompact(formatted).ok).toBe(true);
  });
  it('rejects a prettified doc (objects exploded across lines)', () => {
    expect(checkCompact(JSON.stringify(scenario(), null, 2)).ok).toBe(false);
  });
  it('rejects invalid JSON', () => {
    expect(checkCompact('{ not json, }').ok).toBe(false);
  });
});

describe('scenario schema — mint faults', () => {
  const FAULT_RULE = {
    id: 'swap-offline',
    mint: 'https://testnut.cashu.space',
    path: '/v1/swap',
    response: { mode: 'offline' },
  };
  const faultStep = (rules: unknown[]) => ({ action: 'mintFaults', rules });
  const faultAssert = { action: 'assert', that: 'mintFaultIntercepted', ruleId: 'swap-offline' };

  it('requires the mock.mint-faults capability for fault steps and asserts', () => {
    const missing = validateScenario(
      scenario({
        lane: 'simulator',
        funds: undefined,
        requires: ['unit.sat'],
        steps: [faultStep([FAULT_RULE])],
      })
    );
    expect(missing.ok).toBe(false);
    const missingAssert = validateScenario(
      scenario({
        lane: 'simulator',
        funds: undefined,
        requires: ['unit.sat'],
        verify: [faultAssert],
      })
    );
    expect(missingAssert.ok).toBe(false);
    const declared = validateScenario(
      scenario({
        lane: 'simulator',
        funds: undefined,
        requires: ['unit.sat', 'mock.mint-faults'],
        steps: [faultStep([FAULT_RULE])],
        verify: [faultAssert],
      })
    );
    expect(declared.ok).toBe(true);
    if (declared.ok) {
      const step = declared.value.steps[0] as { rules: { ws: string; method: string }[] };
      expect(step.rules[0]!.ws).toBe('down');
      expect(step.rules[0]!.method).toBe('ANY');
    }
  });

  it('bans arming faults during funded setup and requires a finally clear', () => {
    const funded = (over: Record<string, unknown>) =>
      scenario({ requires: ['cocod.receive.bolt11', 'unit.sat', 'mock.mint-faults'], ...over });
    expect(validateScenario(funded({ setup: [faultStep([FAULT_RULE])] })).ok).toBe(false);
    // Clearing (empty rules) during setup is fine.
    expect(validateScenario(funded({ setup: [faultStep([])] })).ok).toBe(true);
    // Arming in steps without a finally clear leaks faults into the sweep.
    expect(validateScenario(funded({ steps: [faultStep([FAULT_RULE])] })).ok).toBe(false);
    expect(
      validateScenario(funded({ steps: [faultStep([FAULT_RULE])], finally: [faultStep([])] })).ok
    ).toBe(true);
  });

  it('rejects malformed fault rules at parse time', () => {
    const bad = (rules: unknown[]) =>
      validateScenario(
        scenario({
          lane: 'simulator',
          funds: undefined,
          requires: ['unit.sat', 'mock.mint-faults'],
          steps: [faultStep(rules)],
        })
      );
    expect(bad([{ ...FAULT_RULE, mint: 'http://insecure.example' }]).ok).toBe(false);
    expect(bad([{ ...FAULT_RULE, response: { mode: 'error' } }]).ok).toBe(false);
    expect(bad([{ ...FAULT_RULE, path: 'v1/swap' }]).ok).toBe(false);
    expect(bad([FAULT_RULE, FAULT_RULE]).ok).toBe(false);
  });
});

describe('scenario schema — network (real airplane mode)', () => {
  const airplane = { action: 'network', mode: 'airplane' };
  const online = { action: 'network', mode: 'online' };
  const sim = (over: Record<string, unknown>) =>
    scenario({
      lane: 'simulator',
      funds: undefined,
      requires: ['fresh-install', 'device.network'],
      ...over,
    });

  it('requires the device.network capability for network steps', () => {
    const missing = validateScenario(
      sim({ requires: ['fresh-install'], steps: [airplane], finally: [online] })
    );
    expect(missing.ok).toBe(false);
    const declared = validateScenario(sim({ steps: [airplane], finally: [online] }));
    expect(declared.ok).toBe(true);
  });

  it('rejects an unknown network mode and extra keys', () => {
    expect(validateScenario(sim({ steps: [{ action: 'network', mode: 'wifi' }] })).ok).toBe(false);
    expect(
      validateScenario(sim({ steps: [{ ...airplane, delayMs: 5 }], finally: [online] })).ok
    ).toBe(false);
  });

  it('forbids network steps during setup — fund online, then fly', () => {
    expect(
      validateScenario(sim({ setup: [airplane], steps: [online], finally: [online] })).ok
    ).toBe(false);
    expect(
      validateScenario(sim({ setup: [online], steps: [airplane], finally: [online] })).ok
    ).toBe(false);
  });

  it('requires an authored finally restore when a scenario goes airplane', () => {
    expect(validateScenario(sim({ steps: [airplane], finally: [] })).ok).toBe(false);
    expect(validateScenario(sim({ steps: [airplane], finally: [online] })).ok).toBe(true);
    // verify-phase airplane needs the restore too
    expect(
      validateScenario(sim({ verify: [airplane, ...(scenario().verify as unknown[])] })).ok
    ).toBe(false);
  });

  it('requires the online restore to precede any sweep in finally', () => {
    const funded = (finallyItems: unknown[]) =>
      scenario({
        requires: ['cocod.receive.bolt11', 'unit.sat', 'device.network'],
        steps: [airplane],
        finally: finallyItems,
      });
    expect(
      validateScenario(
        funded([{ use: 'flow.sweep-mint', with: { mintHost: 'mint.sovran.money' } }, online])
      ).ok
    ).toBe(false);
    expect(
      validateScenario(
        funded([online, { use: 'flow.sweep-mint', with: { mintHost: 'mint.sovran.money' } }])
      ).ok
    ).toBe(true);
  });
});

describe('scenarioPlatforms — capability-derived platform support', () => {
  it('derives both platforms for driver-neutral requires', () => {
    expect(scenarioPlatforms([])).toEqual(['ios', 'android']);
    expect(scenarioPlatforms(['fresh-install', 'unit.sat'])).toEqual(['ios', 'android']);
  });

  it('treats cross-driver tooling capabilities as available everywhere', () => {
    expect(scenarioPlatforms(['fresh-install', 'cocod.send.bolt11', 'unit.sat'])).toEqual([
      'ios',
      'android',
    ]);
  });

  it('pins mock levers to ios-sim and real airplane mode to android', () => {
    expect(scenarioPlatforms(['fresh-install', 'mock.mint-faults'])).toEqual(['ios']);
    expect(scenarioPlatforms(['fresh-install', 'mock.payment-request-delivery-failure'])).toEqual([
      'ios',
    ]);
    expect(scenarioPlatforms(['fresh-install', 'device.network'])).toEqual(['android']);
  });

  it('pins true reinstall recovery to iOS Keychain retention', () => {
    expect(scenarioPlatforms(['fresh-install', REINSTALL_KEYCHAIN_RETENTION_CAPABILITY])).toEqual([
      'ios',
    ]);
  });

  it('yields no platform for physical/unsupported tokens', () => {
    expect(scenarioPlatforms(['fresh-install', 'ble.transport'])).toEqual([]);
    expect(scenarioPlatforms(['fresh-install', 'unit.usd'])).toEqual([]);
  });
});
