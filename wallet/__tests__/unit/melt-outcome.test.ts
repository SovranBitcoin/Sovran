import { describe, expect, it } from 'vitest';
import { MintOperationError, NetworkError, OperationInProgressError } from '@cashu/coco-core';

import {
  meltDidNotPay,
  meltNeverSent,
  meltSettledUnpaid,
  outcomeOfFailedMeltExecute,
} from '../../src/melt-outcome';

const LOST = new NetworkError('Network request failed');
const REFUSED = new MintOperationError(20004, 'Lightning payment failed');

describe('melt states that prove a melt did not pay', () => {
  it('takes a settled state as proof whoever holds the melt', () => {
    expect(['failed', 'rolled_back'].map(meltSettledUnpaid)).toEqual([true, true]);
    expect(
      ['init', 'prepared', 'executing', 'pending', 'rolling_back', 'finalized'].map(
        meltSettledUnpaid
      )
    ).toEqual([false, false, false, false, false, false]);
  });

  it('takes an unsent state as proof only for the caller whose execute returned', () => {
    expect(['init', 'prepared'].map(meltNeverSent)).toEqual([true, true]);
    expect(['executing', 'pending', 'rolling_back', 'finalized'].map(meltNeverSent)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(
      ['failed', 'rolled_back', 'init', 'prepared', 'executing', 'pending', 'rolling_back'].map(
        meltDidNotPay
      )
    ).toEqual([true, true, true, true, false, false, false]);
  });
});

describe('outcomeOfFailedMeltExecute', () => {
  it('reports a finalized melt as paid whatever execute threw', () => {
    expect(outcomeOfFailedMeltExecute(LOST, 'finalized')).toBe('paid');
    expect(outcomeOfFailedMeltExecute(REFUSED, 'finalized')).toBe('paid');
  });

  it.each(['failed', 'rolled_back', 'init', 'prepared'])(
    'reports a melt left %s as not paid',
    (state) => {
      expect(outcomeOfFailedMeltExecute(LOST, state)).toBe('notPaid');
    }
  );

  it.each(['executing', 'pending', 'rolling_back', 'some_future_state'])(
    'never calls a melt left %s unpaid, even when the mint refused',
    (state) => {
      expect(outcomeOfFailedMeltExecute(LOST, state)).toBe('unknown');
      expect(outcomeOfFailedMeltExecute(REFUSED, state)).toBe('unknown');
    }
  );

  it('believes only a refusal that cannot follow a payment when the state cannot be read', () => {
    expect(outcomeOfFailedMeltExecute(REFUSED, null)).toBe('notPaid');
    expect(outcomeOfFailedMeltExecute(LOST, null)).toBe('unknown');
    expect(outcomeOfFailedMeltExecute(new MintOperationError(11001, 'spent'), null)).toBe(
      'unknown'
    );
    expect(outcomeOfFailedMeltExecute(new Error('Route not found'), null)).toBe('unknown');
  });

  it('takes only a settled state as proof when another call holds the melt', () => {
    const held = new OperationInProgressError('op-1');
    expect(outcomeOfFailedMeltExecute(held, 'prepared')).toBe('unknown');
    expect(outcomeOfFailedMeltExecute(held, null)).toBe('unknown');
    expect(outcomeOfFailedMeltExecute(held, 'rolled_back')).toBe('notPaid');
    expect(outcomeOfFailedMeltExecute(held, 'finalized')).toBe('paid');
  });
});
