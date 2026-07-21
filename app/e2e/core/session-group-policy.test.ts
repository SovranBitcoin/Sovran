import { describe, expect, it } from 'bun:test';
import { assessSessionGroupCompletion, shouldRunSessionGroupMember } from './session-group-policy';

describe('shouldRunSessionGroupMember', () => {
  it('runs only the passing dependency prefix inside a shared session group', () => {
    expect(
      shouldRunSessionGroupMember({ memberIndex: 0, newInstance: true, predecessor: undefined })
    ).toBe(true);
    expect(
      shouldRunSessionGroupMember({ memberIndex: 1, newInstance: false, predecessor: 'passed' })
    ).toBe(true);
    expect(
      shouldRunSessionGroupMember({ memberIndex: 1, newInstance: false, predecessor: 'failed' })
    ).toBe(false);
    expect(
      shouldRunSessionGroupMember({ memberIndex: 1, newInstance: false, predecessor: 'deferred' })
    ).toBe(false);
  });
});

describe('assessSessionGroupCompletion', () => {
  it('continues with the next independent group after a scenario failure', () => {
    expect(
      assessSessionGroupCompletion({
        statuses: ['failed'],
        expectedScenarios: 2,
        fundedSession: false,
      })
    ).toEqual({ shouldContinue: true, outcome: 'scenario-failed' });
  });

  it('preserves an incomplete dependency prefix without blocking later groups', () => {
    expect(
      assessSessionGroupCompletion({
        statuses: ['deferred'],
        expectedScenarios: 2,
        fundedSession: false,
      })
    ).toEqual({ shouldContinue: true, outcome: 'dependency-prefix-incomplete' });
  });

  it('continues after a safely reconciled funded scenario failure', () => {
    expect(
      assessSessionGroupCompletion({
        statuses: ['failed'],
        expectedScenarios: 1,
        fundedSession: true,
        fundsReconciled: true,
      })
    ).toEqual({ shouldContinue: true, outcome: 'scenario-failed' });
  });

  it('stops before another group when funded reconciliation is not proven', () => {
    for (const fundsReconciled of [false, undefined]) {
      expect(
        assessSessionGroupCompletion({
          statuses: ['failed'],
          expectedScenarios: 1,
          fundedSession: true,
          fundsReconciled,
        })
      ).toEqual({ shouldContinue: false, outcome: 'unsafe-funds' });
    }
  });
});
