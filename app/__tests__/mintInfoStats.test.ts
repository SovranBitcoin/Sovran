import {
  mintInfoStatCards,
  selectMintInfoStats,
  type MintInfoStats,
} from '@/features/mint/lib/mintInfoStats';
import { auditGroupFromDiscover } from '@/features/mint/lib/auditInfo';
import { mergeAuditorEntries } from '@/shared/lib/cashu/auditors/discoverMints';
import type { AuditObservation } from '@/shared/lib/cashu/auditors/observation';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';

const radar: AuditObservation = {
  source: 'mintradar',
  observedAt: 10,
  uptime: { pct: 99.5, window: '24h' },
  operations: { okCount: 48, totalCount: 50, window: '7d' },
  latency: { ms: 145, kind: 'median', window: '24h' },
};
const ucash: AuditObservation = {
  source: 'ucash',
  observedAt: 10,
  uptime: { pct: 96, window: '24h', checks: 25 },
  operations: { okCount: 111, totalCount: 128, window: 'all' },
  latency: { ms: 3394, kind: 'mean', window: '24h' },
  auditorMintId: 2,
};
const macadamia: AuditObservation = {
  source: 'macadamia',
  observedAt: 10,
  uptime: { pct: 80, window: '24h', checks: 10 },
  operations: { okCount: 1, totalCount: 2, window: 'all' },
  latency: { ms: 900, kind: 'mean', window: 'all' },
};

const entry = (
  auditObservations: MintMetadataEntry['auditObservations'],
  rest: Partial<MintMetadataEntry> = {}
): MintMetadataEntry => ({ auditObservations, ...rest });

describe('Mint Info four-stat precedence', () => {
  it('prefers MintRadar for every stat when it has them', () => {
    expect(selectMintInfoStats(entry({ mintradar: radar, ucash, macadamia }))).toEqual({
      uptime: { pct: 99.5, source: 'mintradar' },
      operations: { okCount: 48, totalCount: 50, window: '7d', source: 'mintradar' },
      latency: { ms: 145, kind: 'median', window: '24h', source: 'mintradar' },
    });
  });

  it('falls to uCash, then Macadamia, per stat', () => {
    expect(selectMintInfoStats(entry({ ucash, macadamia }))).toEqual({
      uptime: { pct: 96, source: 'ucash', checks: 25 },
      operations: { okCount: 111, totalCount: 128, window: 'all', source: 'ucash' },
      latency: { ms: 3394, kind: 'mean', window: '24h', source: 'ucash' },
    });
    expect(selectMintInfoStats(entry({ macadamia }))).toMatchObject({
      uptime: { source: 'macadamia' },
      operations: { source: 'macadamia' },
      latency: { ms: 900, window: 'all', source: 'macadamia' },
    });
  });

  it('takes a 24h mean from any CDK source before an all-time mean', () => {
    const ucashAllTime = { ...ucash, latency: { ms: 3000, kind: 'mean', window: 'all' } } as const;
    const macadamia24h = {
      ...macadamia,
      latency: { ms: 700, kind: 'mean', window: '24h' },
    } as const;
    expect(
      selectMintInfoStats(entry({ ucash: ucashAllTime, macadamia: macadamia24h })).latency
    ).toEqual({ ms: 700, kind: 'mean', window: '24h', source: 'macadamia' });
  });

  it('never shows a CDK uptime that rests on no checks', () => {
    const noChecks = { ...ucash, uptime: { pct: 0, window: '24h', checks: 0 } } as const;
    expect(selectMintInfoStats(entry({ ucash: noChecks })).uptime).toBeUndefined();
  });

  it('keeps numerator and denominator from one source: a source missing one is skipped whole', () => {
    // MintRadar measured uptime but sampled no operations; uCash did.
    const radarNoOps: AuditObservation = { ...radar, operations: undefined };
    const stats = selectMintInfoStats(entry({ mintradar: radarNoOps, ucash }));
    expect(stats.uptime?.source).toBe('mintradar');
    expect(stats.operations).toEqual({
      okCount: 111,
      totalCount: 128,
      window: 'all',
      source: 'ucash',
    });
    // A corrupt group (more successes than attempts) is never shown either.
    const corrupt: AuditObservation = {
      ...radar,
      operations: { okCount: 60, totalCount: 50, window: '7d' },
    };
    expect(selectMintInfoStats(entry({ mintradar: corrupt, ucash })).operations?.source).toBe(
      'ucash'
    );
  });

  it('falls back to the saved 8333 audit when no source has a reading', () => {
    const stats = selectMintInfoStats(
      entry(undefined, { nMints: 120, nMelts: 80, nErrors: 2, auditState: 'OK' })
    );
    expect(stats.operations).toEqual({
      okCount: 200,
      totalCount: 202,
      window: 'all',
      source: 'saved',
    });
    expect(stats.uptime).toBeUndefined();
  });

  it('never shows a success rate blended from two auditors', () => {
    const [row] = mergeAuditorEntries([
      { source: 'nip87', mintUrl: 'https://blend.example', nMelts: 10, nErrors: 90 },
      { source: 'mintradar', mintUrl: 'https://blend.example', nMints: 200 },
    ]);
    const stats = selectMintInfoStats(entry(undefined, auditGroupFromDiscover(row!)));
    expect(stats.operations).not.toEqual(
      expect.objectContaining({ okCount: 210, totalCount: 300 })
    );
  });

  it('reads the saved directory 8333 reading before the legacy saved audit', () => {
    const cashuAudit: AuditObservation = {
      source: 'cashu-audit',
      observedAt: 1,
      operations: { okCount: 5, totalCount: 10, window: 'all' },
    };
    expect(
      selectMintInfoStats(
        entry({ 'cashu-audit': cashuAudit }, { nMints: 1, nMelts: 1, nErrors: 0 })
      ).operations?.source
    ).toBe('cashu-audit');
  });

  it('reads nothing from an unknown or empty row', () => {
    expect(selectMintInfoStats(undefined)).toEqual({});
    expect(selectMintInfoStats(entry({}))).toEqual({});
    expect(selectMintInfoStats(entry({ ucash: undefined }))).toEqual({});
  });
});

describe('Mint Info four-stat cards', () => {
  it('labels each card with its source and window, and Operations sampled matches the rate', () => {
    const cards = mintInfoStatCards(selectMintInfoStats(entry({ mintradar: radar })));
    expect(cards.map((c) => [c.label, c.value, c.description])).toEqual([
      ['24h uptime', '99.5%', 'MintRadar · last 24h'],
      ['Operation success', '96%', 'MintRadar · last 7 days'],
      ['Probe latency', '145 ms', 'Median (24h) · MintRadar'],
      ['Operations sampled', '50', 'Swap probes · last 7 days'],
    ]);
  });

  it('labels a CDK mean as an average and says how many checks the uptime rests on', () => {
    const cards = mintInfoStatCards(selectMintInfoStats(entry({ ucash })));
    expect(cards.map((c) => [c.value, c.description])).toEqual([
      ['96%', 'uCash · 25 checks'],
      ['86.7%', 'uCash · all time'],
      ['3394 ms', 'Average (24h) · uCash'],
      ['128', 'Mints and melts · all time'],
    ]);
  });

  it('shows a dash, never a zero, for a stat no source measured', () => {
    const none: MintInfoStats = {};
    const cards = mintInfoStatCards(none);
    expect(cards.map((c) => c.value)).toEqual(['—', '—', '—', '—']);
  });
});
