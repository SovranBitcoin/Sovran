import { describe, expect, it } from 'vitest';

import { createAmountActionManager } from '../../src/amount-actions/createManager';
import { resolveAmount } from '../../src/amount-actions/resolve';
import type { CreateAmountActionManagerConfig } from '../../src/amount-actions/types';
import type { AmountEntryEnvelope } from '../../src/mint-capabilities';

const MINT = 'https://mint.example.com';

function makeManager(
  overrides: Partial<CreateAmountActionManagerConfig> & {
    unitRef?: { current: string };
    envelope?: AmountEntryEnvelope | null;
  } = {},
) {
  const unitRef = overrides.unitRef ?? { current: 'sat' };
  const envelope = overrides.envelope ?? null;
  return {
    unitRef,
    manager: createAmountActionManager({
      getMintUrl: () => MINT,
      getProofAmounts: () => [],
      getBtcPrice: () => 100_000,
      offlineOptimization: false,
      unit: () => unitRef.current,
      fiatCurrency: 'usd',
      fiatSymbol: '$',
      quickSendConfig: null,
      getAmountEnvelope: () => envelope,
      ...overrides,
    }),
  };
}

describe('resolveAmount — fiat unit mode', () => {
  const base = {
    inputMode: 'unit' as const,
    proofAmounts: [],
    btcPrice: 0,
    offlineOptimization: false,
  };

  it('converts major-denomination input to integer cents', () => {
    const result = resolveAmount({
      ...base,
      rawInput: '0.1',
      numericValue: 0.1,
      unit: 'usd',
    });
    expect(result.effectiveAmount).toEqual({ value: 10, unit: 'usd' });
    expect(result.displayAmount).toBe(10);
  });

  it('rounds away parseFloat dust instead of truncating', () => {
    // 1.005 * 100 === 100.49999… in IEEE-754; Math.round must win.
    const result = resolveAmount({
      ...base,
      rawInput: '1.005',
      numericValue: 1.005,
      unit: 'usd',
    });
    expect(result.effectiveAmount.value).toBe(100);
  });

  it('has no display-currency secondary math (displayFiat is null)', () => {
    const result = resolveAmount({
      ...base,
      rawInput: '5',
      numericValue: 5,
      unit: 'eur',
      btcPrice: 100_000,
    });
    expect(result.displayFiat).toBeNull();
    expect(result.effectiveAmount).toEqual({ value: 500, unit: 'eur' });
  });

  it('sat unit mode is unchanged: integer sats with fiat display', () => {
    const result = resolveAmount({
      ...base,
      rawInput: '1000',
      numericValue: 1000,
      unit: 'sat',
      btcPrice: 100_000,
    });
    expect(result.effectiveAmount).toEqual({ value: 1000, unit: 'sat' });
    expect(result.displayFiat).toBe(1); // 1000 sats at $100k
  });
});

describe('createAmountActionManager — unit awareness', () => {
  it('fiat account resolves USD input as cents with the unit symbol', () => {
    const { manager } = makeManager({ unitRef: { current: 'usd' } });
    manager.setInput('2.5');
    const state = manager.inspect();
    expect(state.effectiveAmount).toEqual({ value: 250, unit: 'usd' });
    expect(state.unitSymbol).toBe('$');
    expect(state.keyboardUnit).toBe('usd');
    expect(state.secondaryDisplay).toBeNull();
    expect(state.fiatCurrency).toBeNull();
  });

  it('toggle is a no-op on a fiat account', () => {
    const { manager } = makeManager({ unitRef: { current: 'usd' } });
    manager.setInput('3');
    manager.toggle();
    const state = manager.inspect();
    expect(state.inputMode).toBe('unit');
    expect(state.effectiveAmount).toEqual({ value: 300, unit: 'usd' });
  });

  it('setMode(fiat) is rejected on a fiat account', () => {
    const { manager } = makeManager({ unitRef: { current: 'eur' } });
    manager.setMode('fiat');
    expect(manager.inspect().inputMode).toBe('unit');
  });

  it('sat account keeps the display-currency toggle', () => {
    const { manager } = makeManager({ unitRef: { current: 'sat' } });
    manager.setInput('1000');
    manager.toggle();
    const state = manager.inspect();
    expect(state.inputMode).toBe('fiat');
    expect(state.keyboardUnit).toBe('usd');
    // $1 at $100k/BTC round-trips to 1000 sats
    expect(state.effectiveAmount).toEqual({ value: 1000, unit: 'sat' });
  });

  it('a unit switch mid-entry resets the draft', () => {
    const unitRef = { current: 'sat' };
    const { manager } = makeManager({ unitRef });
    manager.setInput('1.5');
    unitRef.current = 'usd';
    const state = manager.inspect();
    expect(state.rawInput).toBe('');
    expect(state.inputMode).toBe('unit');
    expect(state.effectiveAmount).toEqual({ value: 0, unit: 'usd' });
  });
});

describe('createAmountActionManager — suggestions gate', () => {
  const PROOFS = [64, 32, 4];

  it('defaults to the offlineOptimization gate when suggestionsEnabled is omitted', () => {
    const { manager: off } = makeManager({
      getProofAmounts: () => PROOFS,
      offlineOptimization: false,
      quickSendConfig: undefined,
    });
    expect(off.inspect().suggestions).toHaveLength(0);

    const { manager: on } = makeManager({
      getProofAmounts: () => PROOFS,
      offlineOptimization: true,
      quickSendConfig: undefined,
    });
    expect(on.inspect().suggestions.length).toBeGreaterThan(0);
  });

  it('suggestionsEnabled shows suggestions without offline optimization (payment-request shape)', () => {
    const { manager } = makeManager({
      getProofAmounts: () => PROOFS,
      offlineOptimization: false,
      suggestionsEnabled: true,
      quickSendConfig: undefined,
    });
    const state = manager.inspect();
    expect(state.suggestions.length).toBeGreaterThan(0);
    expect(state.suggestions.some((s) => s.sendAll)).toBe(true);
  });

  it('suggestionsEnabled: false suppresses suggestions even with offline optimization on', () => {
    const { manager } = makeManager({
      getProofAmounts: () => PROOFS,
      offlineOptimization: true,
      suggestionsEnabled: false,
      quickSendConfig: undefined,
    });
    expect(manager.inspect().suggestions).toHaveLength(0);
  });

  it('a mid-flow gate flip invalidates the compute memo', () => {
    const gate = { current: false };
    const { manager } = makeManager({
      getProofAmounts: () => PROOFS,
      offlineOptimization: false,
      suggestionsEnabled: () => gate.current,
      quickSendConfig: undefined,
    });
    expect(manager.inspect().suggestions).toHaveLength(0);
    gate.current = true;
    expect(manager.inspect().suggestions.length).toBeGreaterThan(0);
  });
});

describe('createAmountActionManager — envelope clamp', () => {
  it('replaces input above the cap with the cap raw string', () => {
    const { manager } = makeManager({
      unitRef: { current: 'sat' },
      envelope: { unit: 'sat', minAmount: null, maxAmount: 50_000 },
    });
    manager.setInput('60000');
    const state = manager.inspect();
    expect(state.rawInput).toBe('50000');
    expect(state.clampedToCap).toBe(true);
    expect(state.inputCap).toEqual({ value: 50_000, unit: 'sat' });
  });

  it('clears clampedToCap on the next in-range input', () => {
    const { manager } = makeManager({
      unitRef: { current: 'sat' },
      envelope: { unit: 'sat', minAmount: null, maxAmount: 50_000 },
    });
    manager.setInput('60000');
    manager.setInput('400');
    const state = manager.inspect();
    expect(state.rawInput).toBe('400');
    expect(state.clampedToCap).toBe(false);
  });

  it('caps fiat-unit input in the unit itself (cents)', () => {
    const { manager } = makeManager({
      unitRef: { current: 'usd' },
      envelope: { unit: 'usd', minAmount: 5, maxAmount: 1_000 },
    });
    manager.setInput('25');
    const state = manager.inspect();
    expect(state.rawInput).toBe('10'); // $10.00 == 1 000 cents
    expect(state.effectiveAmount).toEqual({ value: 1_000, unit: 'usd' });
    expect(state.clampedToCap).toBe(true);
  });

  it('an envelope for another unit never clamps', () => {
    const { manager } = makeManager({
      unitRef: { current: 'usd' },
      envelope: { unit: 'sat', minAmount: null, maxAmount: 100 },
    });
    manager.setInput('50');
    const state = manager.inspect();
    expect(state.rawInput).toBe('50');
    expect(state.clampedToCap).toBe(false);
    expect(state.inputCap).toBeNull();
  });

  it('null envelope leaves typing uncapped', () => {
    const { manager } = makeManager({ envelope: null });
    manager.setInput('999999999');
    expect(manager.inspect().rawInput).toBe('999999999');
  });
});
