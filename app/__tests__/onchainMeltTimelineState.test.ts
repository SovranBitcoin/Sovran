/**
 * @jest-environment node
 */
import {
  canOnchainMeltQuoteExpire,
  INITIAL_OFFCHAIN_SETTLEMENT_STATE,
  isConfirmedOffchainSettlement,
  isOnchainMeltQuoteExpired,
  isOnchainMeltSettled,
  nextOffchainSettlementState,
  resolveOnchainMeltTimelineState,
} from '@/shared/lib/cashu/onchainMelt';

describe('resolveOnchainMeltTimelineState', () => {
  it('does NOT let a stale UNPAID quote row mask a finalized entry (internal-send bug)', () => {
    // The synchronous-PAID internal-transfer path: the operation finalized but
    // the local melt-quote row was never bumped past its initial UNPAID. A blind
    // `quote ?? entry` returned UNPAID → timeline pinned at "Sent to mint".
    expect(resolveOnchainMeltTimelineState('UNPAID', 'finalized')).toBe('finalized');
    expect(isOnchainMeltSettled(resolveOnchainMeltTimelineState('UNPAID', 'finalized'))).toBe(true);
  });

  it('advances off the operation entry when the quote row is not yet known', () => {
    // Broadcasting case before the first quote refresh resolves.
    expect(resolveOnchainMeltTimelineState(null, 'pending')).toBe('pending');
    expect(resolveOnchainMeltTimelineState(undefined, 'executing')).toBe('executing');
  });

  it('advances off the quote row when the mint confirms before the op finalizes', () => {
    expect(resolveOnchainMeltTimelineState('PAID', 'pending')).toBe('PAID');
    expect(resolveOnchainMeltTimelineState('PENDING', 'prepared')).toBe('PENDING');
  });

  it('keeps the quote row when both sides sit at the same rank', () => {
    expect(resolveOnchainMeltTimelineState('PENDING', 'pending')).toBe('PENDING');
    expect(resolveOnchainMeltTimelineState('UNPAID', 'prepared')).toBe('UNPAID');
  });

  it('lets a rollback/failure on either side win over a stale quote', () => {
    expect(resolveOnchainMeltTimelineState('UNPAID', 'rolledBack')).toBe('rolledBack');
    expect(resolveOnchainMeltTimelineState('PENDING', 'rolled_back')).toBe('rolled_back');
    expect(resolveOnchainMeltTimelineState('failed', 'finalized')).toBe('failed');
  });

  it('falls back gracefully when neither state is recognized', () => {
    expect(resolveOnchainMeltTimelineState(null, null)).toBeNull();
    expect(resolveOnchainMeltTimelineState('weird', undefined)).toBe('weird');
    expect(resolveOnchainMeltTimelineState(undefined, 'mystery')).toBe('mystery');
  });
});

describe('onchain melt quote expiry', () => {
  const EXPIRY = 1_700_000_000; // unix seconds
  const BEFORE_MS = (EXPIRY - 60) * 1000;
  const AFTER_MS = (EXPIRY + 60) * 1000;

  it('only pre-flight states can expire', () => {
    expect(canOnchainMeltQuoteExpire('UNPAID')).toBe(true);
    expect(canOnchainMeltQuoteExpire('prepared')).toBe(true);
    expect(canOnchainMeltQuoteExpire(null)).toBe(true);
    expect(canOnchainMeltQuoteExpire('PENDING')).toBe(false);
    expect(canOnchainMeltQuoteExpire('executing')).toBe(false);
    expect(canOnchainMeltQuoteExpire('PAID')).toBe(false);
    expect(canOnchainMeltQuoteExpire('finalized')).toBe(false);
    expect(canOnchainMeltQuoteExpire('rolledBack')).toBe(false);
  });

  it('expires an UNPAID quote once the expiry moment passes', () => {
    expect(isOnchainMeltQuoteExpired('UNPAID', EXPIRY, BEFORE_MS)).toBe(false);
    expect(isOnchainMeltQuoteExpired('UNPAID', EXPIRY, AFTER_MS)).toBe(true);
  });

  it('never expires an in-flight or settled melt off a stale expiry', () => {
    expect(isOnchainMeltQuoteExpired('PENDING', EXPIRY, AFTER_MS)).toBe(false);
    expect(isOnchainMeltQuoteExpired('PAID', EXPIRY, AFTER_MS)).toBe(false);
    expect(isOnchainMeltQuoteExpired('finalized', EXPIRY, AFTER_MS)).toBe(false);
  });

  it('treats a missing/invalid expiry as never-expired', () => {
    expect(isOnchainMeltQuoteExpired('UNPAID', null, AFTER_MS)).toBe(false);
    expect(isOnchainMeltQuoteExpired('UNPAID', 0, AFTER_MS)).toBe(false);
    expect(isOnchainMeltQuoteExpired('UNPAID', Number.NaN, AFTER_MS)).toBe(false);
  });
});

describe('off-chain settlement debounce', () => {
  const step = nextOffchainSettlementState;

  it('one PAID-no-outpoint read is NOT yet an off-chain settle', () => {
    const s1 = step(INITIAL_OFFCHAIN_SETTLEMENT_STATE, { state: 'PAID', hasOutpoint: false });
    expect(isConfirmedOffchainSettlement(s1)).toBe(false);
  });

  it('two consecutive PAID-no-outpoint reads confirm the off-chain settle', () => {
    const s1 = step(INITIAL_OFFCHAIN_SETTLEMENT_STATE, { state: 'PAID', hasOutpoint: false });
    const s2 = step(s1, { state: 'PAID', hasOutpoint: false });
    expect(isConfirmedOffchainSettlement(s2)).toBe(true);
  });

  it('an outpoint permanently rules out the off-chain verdict (sticky)', () => {
    const s1 = step(INITIAL_OFFCHAIN_SETTLEMENT_STATE, { state: 'PENDING', hasOutpoint: true });
    // A later PAID read that (bogusly) drops the outpoint must not flip it.
    const s2 = step(s1, { state: 'PAID', hasOutpoint: false });
    const s3 = step(s2, { state: 'PAID', hasOutpoint: false });
    expect(isConfirmedOffchainSettlement(s3)).toBe(false);
  });

  it('a non-PAID read resets the consecutive counter', () => {
    const s1 = step(INITIAL_OFFCHAIN_SETTLEMENT_STATE, { state: 'PAID', hasOutpoint: false });
    const s2 = step(s1, { state: 'PENDING', hasOutpoint: false });
    const s3 = step(s2, { state: 'PAID', hasOutpoint: false });
    expect(isConfirmedOffchainSettlement(s3)).toBe(false);
  });
});

describe('isOnchainMeltSettled', () => {
  it('treats PAID and finalized as settled, everything else as not', () => {
    expect(isOnchainMeltSettled('PAID')).toBe(true);
    expect(isOnchainMeltSettled('finalized')).toBe(true);
    expect(isOnchainMeltSettled('PENDING')).toBe(false);
    expect(isOnchainMeltSettled('pending')).toBe(false);
    expect(isOnchainMeltSettled('UNPAID')).toBe(false);
    expect(isOnchainMeltSettled(null)).toBe(false);
    expect(isOnchainMeltSettled('rolledBack')).toBe(false);
  });
});
