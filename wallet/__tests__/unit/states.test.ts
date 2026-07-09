import { describe, expect, it } from 'vitest';

import {
  entryStateRank,
  isTerminalFailureState,
  isTimelineFlow,
  normalizeContractState,
  normalizeTimelineMeltState,
  normalizeTimelineMintState,
  resolveEntryState,
} from '../../src/history/states';

describe('isTerminalFailureState', () => {
  it('covers all four failure spellings and nothing else', () => {
    for (const s of ['rolledBack', 'rolled_back', 'rolling_back', 'failed']) {
      expect(isTerminalFailureState(s)).toBe(true);
    }
    for (const s of ['UNPAID', 'PAID', 'finalized', 'expired', null, undefined, '']) {
      expect(isTerminalFailureState(s)).toBe(false);
    }
  });
});

describe('normalizeContractState (list / bridge vocabulary)', () => {
  it('maps mint operation states to the legacy vocabulary', () => {
    expect(normalizeContractState('mint', 'pending')).toBe('UNPAID');
    expect(normalizeContractState('mint', 'executing')).toBe('PAID');
    expect(normalizeContractState('mint', 'finalized')).toBe('ISSUED');
    // Conscious v1 compromise (no legacy failure state on the list model).
    expect(normalizeContractState('mint', 'failed')).toBe('UNPAID');
  });

  it('maps melt operation states to the legacy vocabulary', () => {
    expect(normalizeContractState('melt', 'prepared')).toBe('UNPAID');
    expect(normalizeContractState('melt', 'pending')).toBe('PENDING');
    expect(normalizeContractState('melt', 'executing')).toBe('PENDING');
    expect(normalizeContractState('melt', 'finalized')).toBe('PAID');
  });

  it('normalizes rolled_back for every flow; passes legacy/unknown through', () => {
    for (const flow of ['mint', 'melt', 'send', 'receive'] as const) {
      expect(normalizeContractState(flow, 'rolled_back')).toBe('rolledBack');
    }
    expect(normalizeContractState('melt', 'UNPAID')).toBe('UNPAID');
    expect(normalizeContractState('send', 'prepared')).toBe('prepared');
    expect(normalizeContractState('melt', 'weird')).toBe('weird');
  });
});

describe('normalizeTimelineMintState', () => {
  it('aliases the operation vocabulary but KEEPS failed renderable', () => {
    expect(normalizeTimelineMintState('finalized')).toBe('ISSUED');
    expect(normalizeTimelineMintState('executing')).toBe('PAID');
    expect(normalizeTimelineMintState('pending')).toBe('UNPAID');
    expect(normalizeTimelineMintState('failed')).toBe('failed');
  });

  it('prefers a known remoteState for still-pending operations', () => {
    expect(normalizeTimelineMintState('pending', 'PAID')).toBe('PAID');
    // Terminal aliases beat remoteState — a finalized op is done.
    expect(normalizeTimelineMintState('finalized', 'PAID')).toBe('ISSUED');
    // Unknown remoteState is ignored.
    expect(normalizeTimelineMintState('pending', 'garbage')).toBe('UNPAID');
  });

  it('passes native and unknown states through', () => {
    expect(normalizeTimelineMintState('UNPAID')).toBe('UNPAID');
    expect(normalizeTimelineMintState('mystery')).toBe('mystery');
  });
});

describe('normalizeTimelineMeltState', () => {
  it('aliases, passes native through, defaults unknown to UNPAID', () => {
    expect(normalizeTimelineMeltState('finalized')).toBe('PAID');
    expect(normalizeTimelineMeltState('pending')).toBe('PENDING');
    expect(normalizeTimelineMeltState('executing')).toBe('PENDING');
    expect(normalizeTimelineMeltState('PAID')).toBe('PAID');
    expect(normalizeTimelineMeltState('mystery')).toBe('UNPAID');
  });
});

describe('entryStateRank', () => {
  it('ranks both vocabularies per flow, -1 for unknown', () => {
    expect(entryStateRank('mint', 'UNPAID')).toBe(0);
    expect(entryStateRank('mint', 'pending')).toBe(0);
    expect(entryStateRank('mint', 'PAID')).toBe(1);
    expect(entryStateRank('mint', 'executing')).toBe(1);
    expect(entryStateRank('mint', 'ISSUED')).toBe(2);
    expect(entryStateRank('mint', 'finalized')).toBe(2);
    expect(entryStateRank('melt', 'prepared')).toBe(0);
    expect(entryStateRank('melt', 'PENDING')).toBe(1);
    expect(entryStateRank('melt', 'finalized')).toBe(2);
    expect(entryStateRank('send', 'prepared')).toBe(0);
    expect(entryStateRank('receive', 'executing')).toBe(1);
    expect(entryStateRank('melt', 'weird')).toBe(-1);
    expect(entryStateRank('melt', null)).toBe(-1);
  });
});

describe('resolveEntryState', () => {
  it('most-advanced state wins across vocabularies', () => {
    expect(resolveEntryState('melt', 'UNPAID', 'finalized')).toBe('finalized');
    expect(resolveEntryState('melt', 'PAID', 'pending')).toBe('PAID');
    expect(resolveEntryState('mint', 'executing', 'ISSUED')).toBe('ISSUED');
  });

  it('terminal failure on either side wins outright', () => {
    expect(resolveEntryState('melt', 'PAID', 'rolled_back')).toBe('rolled_back');
    expect(resolveEntryState('melt', 'rolledBack', 'PENDING')).toBe('rolledBack');
    expect(resolveEntryState('melt', 'UNPAID', 'rolling_back')).toBe('rolling_back');
  });

  it('ties and unknowns prefer the first argument', () => {
    expect(resolveEntryState('melt', 'UNPAID', 'prepared')).toBe('UNPAID');
    expect(resolveEntryState('melt', 'weird', undefined)).toBe('weird');
    expect(resolveEntryState('melt', undefined, 'mystery')).toBe('mystery');
    expect(resolveEntryState('melt', null, null)).toBeNull();
  });
});

describe('isTimelineFlow', () => {
  it('accepts the four flows only', () => {
    expect(isTimelineFlow('mint')).toBe(true);
    expect(isTimelineFlow('melt')).toBe(true);
    expect(isTimelineFlow('send')).toBe(true);
    expect(isTimelineFlow('receive')).toBe(true);
    expect(isTimelineFlow('swap')).toBe(false);
    expect(isTimelineFlow(undefined)).toBe(false);
  });
});
