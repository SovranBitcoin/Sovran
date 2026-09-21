import { auditScoreFromOps } from '@/features/mint/lib/auditScore';

describe('auditScoreFromOps', () => {
  it('rates successes against successes plus errors, on a 0..5 scale', () => {
    expect(auditScoreFromOps({ nMints: 30, nMelts: 10, nErrors: 10 })).toEqual({
      score: 4,
      totalOps: 50,
    });
  });
  it('stays bounded for error-heavy mints instead of going negative', () => {
    const { score } = auditScoreFromOps({ nMints: 20, nMelts: 19, nErrors: 235 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(5);
  });
  it('has no score when nothing was recorded or a count is unknown', () => {
    expect(auditScoreFromOps({ nMints: 0, nMelts: 0, nErrors: 0 })).toEqual({
      score: null,
      totalOps: 0,
    });
    expect(auditScoreFromOps({ nMints: 5, nMelts: 5 })).toEqual({ score: null, totalOps: 0 });
    expect(auditScoreFromOps({})).toEqual({ score: null, totalOps: 0 });
  });
});
