/**
 * Every way an AI send can fail to start has a name.
 *
 * The wallet's own flows put their preconditions in a machine; this send had
 * them scattered through a long handler, so a missing provider, a mint the
 * provider refuses and a declined confirmation all looked the same from
 * outside — nothing happened, with nothing said. These pin the order too,
 * because the order is what decides whether the advice is actionable: "add
 * funds" is the wrong answer when the real problem is that nobody has been
 * picked to pay.
 */

import { evaluateSendGate, type SendGateInput } from '@/features/ai/lib/sendGate';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

const MINIBITS = 'https://mint.minibits.cash/Bitcoin';
const SOVRAN = 'https://mint.sovran.money';

/** `completion` drives the reserve: the node holds `max_tokens` worth of it up
 *  front, which is the figure the gate has to clear. */
const entry = (completion: number): LineupEntry => ({
  modelId: 'gpt-oss-20b',
  displayName: 'GPT-OSS 20B',
  contextLength: 128_000,
  created: 1_750_000_000,
  visionInput: false,
  satsPricing: { prompt: 1e-6, completion, request: 0, image: null, max_cost: completion * 4096 },
  maxCompletionTokens: null,
});

const base = (overrides: Partial<SendGateInput> = {}): SendGateInput => ({
  text: 'hello',
  providerBaseUrl: 'https://node.example',
  providerMints: [MINIBITS],
  heldMints: new Set([MINIBITS]),
  walletSats: 10_000,
  entry: entry(4e-6),
  imageCount: 0,
  confirmSpend: false,
  // The node's own gate for this body, computed by `reservedSatsForSend` in
  // the send path and pinned separately in `aiReserve.test.ts`. The gate
  // takes it rather than deriving it, so these cases can state it outright.
  reservedSats: 20,
  ...overrides,
});

describe('AI send gate', () => {
  it('does nothing for an empty message', () => {
    expect(evaluateSendGate(base({ text: '   ' })).state).toBe('empty');
  });

  it('refuses before a provider is chosen, ahead of every other check', () => {
    // Deliberately also unaffordable and mint-less: no provider outranks both,
    // because there is nobody to pay and no mints to compare against.
    const outcome = evaluateSendGate(
      base({ providerBaseUrl: null, walletSats: 0, heldMints: new Set() })
    );
    expect(outcome.state).toBe('no-provider');
  });

  it('names a mint the provider will not take, rather than calling it a shortfall', () => {
    const outcome = evaluateSendGate(
      base({ heldMints: new Set([SOVRAN.toLowerCase()]), walletSats: 10_000 })
    );
    expect(outcome).toMatchObject({ state: 'mint-not-accepted', providerMints: [MINIBITS] });
  });

  it('matches a trailing slash and host case without changing the path', () => {
    const outcome = evaluateSendGate(
      base({
        providerMints: ['https://MINT.MINIBITS.CASH/Bitcoin/'],
        heldMints: new Set([MINIBITS]),
      })
    );
    expect(outcome.state).not.toBe('mint-not-accepted');
  });

  it('does not treat a differently cased path as the same mint', () => {
    expect(evaluateSendGate(base({ providerMints: [MINIBITS.toLowerCase()] })).state).toBe(
      'mint-not-accepted'
    );
  });

  it('treats a provider that publishes no mints as taking any', () => {
    const outcome = evaluateSendGate(base({ providerMints: [], heldMints: new Set() }));
    expect(outcome.state).toBe('ready');
  });

  it('gates on what the node reserves, not what the turn is expected to cost', () => {
    // A frontier model reserves its ceiling up front and returns the rest as
    // change; gating on the estimate lets a send through that the node refuses.
    const outcome = evaluateSendGate(base({ reservedSats: 900, walletSats: 100 }));
    expect(outcome).toMatchObject({ state: 'insufficient-funds', haveSats: 100 });
    expect((outcome as { needSats: number }).needSats).toBeGreaterThan(100);
  });

  it('quotes the reservation unpadded and funds the padded one', () => {
    // Two numbers with two jobs. The user approves what actually leaves the
    // wallet; the balance has to clear a little more than that, because our
    // catalogue snapshot and the SDK's can drift between refreshes. Padding
    // the quoted figure instead would make it a different number from the one
    // that goes — which is the bug this whole change exists to fix.
    const outcome = evaluateSendGate(base({ confirmSpend: true, reservedSats: 307 }));
    expect(outcome).toMatchObject({ state: 'confirm', reserveSats: 307, reserveKnown: true });
    expect(evaluateSendGate(base({ reservedSats: 307, walletSats: 320 }))).toMatchObject({
      state: 'insufficient-funds',
      needSats: 338,
    });
  });

  it('falls back to the typical-turn estimate, and says it is one', () => {
    // No pricing means nothing true to quote. The estimate stands in, flagged,
    // rather than a confident figure the node will contradict.
    const outcome = evaluateSendGate(base({ confirmSpend: true, reservedSats: null }));
    expect(outcome).toMatchObject({ state: 'confirm', reserveKnown: false });
    expect((outcome as { reserveSats: number }).reserveSats).toBeGreaterThan(0);
  });

  it('asks before spending when the user wants to be asked', () => {
    const outcome = evaluateSendGate(base({ confirmSpend: true }));
    expect(outcome).toMatchObject({ state: 'confirm', modelName: 'GPT-OSS 20B' });
  });

  it('goes straight through once the user has turned the prompt off', () => {
    expect(evaluateSendGate(base()).state).toBe('ready');
  });
});
