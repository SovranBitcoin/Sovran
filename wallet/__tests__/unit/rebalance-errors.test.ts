import { describe, expect, it } from 'vitest';
import {
  MintOperationError,
  NetworkError,
  OperationInProgressError,
  ProofValidationError,
} from '@cashu/coco-core';

import { computeInitialTransferAmount } from '../../src/rebalance/amounts';
import {
  classifyRebalanceError,
  meltRefusedBeforePaying,
  RebalanceRoutesExhaustedError,
} from '../../src/rebalance/errors';

describe('classifyRebalanceError', () => {
  it('classifies typed coco errors and NUT codes before any text', () => {
    expect(classifyRebalanceError(new OperationInProgressError('op-1'))).toBe(
      'operation_in_progress'
    );
    expect(classifyRebalanceError(new MintOperationError(20005, 'Quote is pending'))).toBe(
      'operation_in_progress'
    );
    expect(classifyRebalanceError(new MintOperationError(11002, 'Proofs are pending'))).toBe(
      'operation_in_progress'
    );
    expect(classifyRebalanceError(new MintOperationError(11005, 'unbalanced'))).toBe(
      'input_shortfall'
    );
    // A code outranks misleading detail text.
    expect(classifyRebalanceError(new MintOperationError(20005, 'no_route'))).toBe(
      'operation_in_progress'
    );
  });

  it('reads the code of a MintOperationError from another cashu-ts realm', () => {
    const foreign = Object.assign(new Error('pending'), { name: 'MintOperationError', code: 20005 });
    expect(classifyRebalanceError(foreign)).toBe('operation_in_progress');
  });

  it('separates the proof shortfall from other proof validation failures', () => {
    expect(classifyRebalanceError(new ProofValidationError('Not enough proofs to send'))).toBe(
      'insufficient_proofs'
    );
    expect(classifyRebalanceError(new ProofValidationError('mintUrl is required'))).toBe('other');
  });

  it('falls back to mint detail text only for conditions without a code', () => {
    expect(
      classifyRebalanceError(
        new MintOperationError(11000, 'not enough inputs provided for melt. Provided: 13, needed: 14')
      )
    ).toBe('input_shortfall');
    expect(
      classifyRebalanceError(new MintOperationError(20004, 'payment failed: FAILURE_REASON_NO_ROUTE'))
    ).toBe('no_route');
    expect(classifyRebalanceError(new Error('Ran out of routes'))).toBe('no_route');
    expect(classifyRebalanceError(new Error('Melt operation already in progress'))).toBe(
      'operation_in_progress'
    );
  });

  it('never classifies unknown values or unrelated failures as retryable', () => {
    expect(classifyRebalanceError('no_route')).toBe('other');
    expect(classifyRebalanceError(null)).toBe('other');
    expect(classifyRebalanceError(new NetworkError('fetch failed'))).toBe('other');
    expect(classifyRebalanceError(new MintOperationError(11001, 'Token already spent'))).toBe(
      'other'
    );
  });

  it('keeps the last route error as the cause of an exhausted-routes error', () => {
    const last = new MintOperationError(20004, 'Lightning payment failed');
    const error = new RebalanceRoutesExhaustedError(3, { cause: last });
    expect(error.cause).toBe(last);
    expect(error.triedCount).toBe(3);
  });
});

describe('meltRefusedBeforePaying', () => {
  it('believes only codes that a melt which paid cannot be answered with', () => {
    for (const code of [10001, 11005, 11007, 11008, 11009, 20004]) {
      expect(meltRefusedBeforePaying(new MintOperationError(code, 'refused'))).toBe(true);
    }
    const foreign = Object.assign(new Error('failed'), { name: 'MintOperationError', code: 20004 });
    expect(meltRefusedBeforePaying(foreign)).toBe(true);
  });

  it('treats an answer that may be this melt having paid, or no answer, as proving nothing', () => {
    // Proofs spent, outputs signed or the invoice paid: perhaps by this melt.
    // CDK answers a unit mismatch (11010) after its backend reported the payment paid.
    for (const code of [
      11001, 11003, 20006, 11002, 11004, 20005, 12001, 12002, 11006, 11010, 50000,
    ]) {
      expect(meltRefusedBeforePaying(new MintOperationError(code, 'answered'))).toBe(false);
    }
    expect(meltRefusedBeforePaying(new NetworkError('socket hang up'))).toBe(false);
    expect(meltRefusedBeforePaying(new Error('not enough inputs provided for melt'))).toBe(false);
    expect(meltRefusedBeforePaying(null)).toBe(false);
  });
});

describe('computeInitialTransferAmount', () => {
  it('decides whether a transfer runs, is capped, or is skipped by fee headroom', () => {
    const base = { requestedAmount: 100, minTransferThreshold: 10, feeHeadroom: 5 };
    expect(computeInitialTransferAmount({ ...base, sourceBalance: 150 })).toEqual({
      status: 'ready',
      amount: 100,
      capped: false,
    });
    expect(computeInitialTransferAmount({ ...base, sourceBalance: 102 })).toEqual({
      status: 'capped',
      amount: 97,
      capped: true,
    });
    expect(computeInitialTransferAmount({ ...base, sourceBalance: 14 })).toEqual({
      status: 'skip',
      minRequired: 15,
    });
  });

  it('keeps transfer amounts whole before invoice creation', () => {
    const base = { minTransferThreshold: 10, feeHeadroom: 5 };
    expect(
      computeInitialTransferAmount({ ...base, requestedAmount: 100.9, sourceBalance: 150 })
    ).toEqual({ status: 'ready', amount: 100, capped: false });
    expect(
      computeInitialTransferAmount({ ...base, requestedAmount: 100, sourceBalance: 102.5 })
    ).toEqual({ status: 'capped', amount: 97, capped: true });
  });
});
