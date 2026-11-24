import {
  mintAuditDetailDue,
  MINT_AUDIT_DETAIL_TTL_MS,
  readMintAuditDetail,
  resetMintAuditDetailClock,
} from '@/features/mint/lib/mintAuditDetail';
import { discoverMintsFromAuditors } from '@/shared/lib/cashu/auditors/discoverMints';

jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: () => null }));
jest.mock('@/shared/lib/logger', () => ({
  apiLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const MINT = 'https://mint.minibits.cash/Bitcoin';

function deps() {
  return {
    fetchMintRadarSingle: jest.fn(async () => undefined),
    findCdkMint: jest.fn(async (id: 'ucash' | 'macadamia') => ({
      source: id,
      mintUrl: MINT,
      observation: {
        source: id,
        observedAt: 1,
        operations: { okCount: 9, totalCount: 10, window: 'all' as const },
        auditorMintId: 2,
      },
    })),
    fetchCdkMintUptime: jest.fn(async () => ({ checks: 25, uptime_percent: 100 })),
    fetchCdkMintMetrics: jest.fn(async () => ({
      successes: 230,
      successes_24h: 3,
      avg_latency_ms: 3426,
      avg_latency_ms_24h: 3394,
    })),
  };
}

beforeEach(() => resetMintAuditDetailClock());
afterEach(() => jest.restoreAllMocks());

describe('Mint Info lazy auditor detail', () => {
  it('asks only enabled sources, and the saved auditor id spares the search', async () => {
    const d = deps();
    const { updates, answered } = await readMintAuditDetail(MINT, {
      held: {
        ucash: { source: 'ucash', observedAt: 1, auditorMintId: 7 },
      },
      disabledAuditors: ['mintradar'],
      enabledAuditors: [],
      signal: new AbortController().signal,
      deps: d,
    });
    expect(answered).toBe(true);
    expect(d.fetchMintRadarSingle).not.toHaveBeenCalled();
    // Macadamia is off by default: never asked.
    expect(d.findCdkMint).not.toHaveBeenCalled();
    expect(d.fetchCdkMintUptime).toHaveBeenCalledTimes(1);
    expect(d.fetchCdkMintUptime).toHaveBeenCalledWith('ucash', 7, expect.any(Object));
    expect(updates).toEqual([
      {
        source: 'ucash',
        observedAt: expect.any(Number),
        uptime: { pct: 100, window: '24h', checks: 25 },
        latency: { ms: 3394, kind: 'mean', window: '24h' },
      },
    ]);
  });

  it('finds the auditor id with one search when none is saved, and asks Macadamia once on', async () => {
    const d = deps();
    const { updates } = await readMintAuditDetail(MINT, {
      held: undefined,
      disabledAuditors: ['mintradar', 'ucash'],
      enabledAuditors: ['macadamia'],
      signal: new AbortController().signal,
      deps: d,
    });
    expect(d.findCdkMint).toHaveBeenCalledTimes(1);
    expect(d.findCdkMint).toHaveBeenCalledWith('macadamia', MINT, expect.any(Object));
    expect(d.fetchCdkMintMetrics).toHaveBeenCalledWith('macadamia', 2, expect.any(Object));
    expect(updates.map((u) => u.source)).toEqual(['macadamia', 'macadamia']);
  });

  it('reports nothing answered when every source is silent, and never throws', async () => {
    const d = deps();
    d.findCdkMint.mockResolvedValue(undefined as never);
    const result = await readMintAuditDetail(MINT, {
      held: undefined,
      disabledAuditors: [],
      enabledAuditors: [],
      signal: new AbortController().signal,
      deps: d,
    });
    expect(result).toEqual({ updates: [], answered: false });
  });

  it('reads a mint at most once per TTL, and an aborted read does not count', async () => {
    const now = Date.now();
    expect(mintAuditDetailDue(MINT, now)).toBe(true);
    await readMintAuditDetail(MINT, {
      held: undefined,
      disabledAuditors: [],
      enabledAuditors: [],
      signal: new AbortController().signal,
      deps: deps(),
    });
    expect(mintAuditDetailDue(MINT, Date.now())).toBe(false);
    expect(mintAuditDetailDue(MINT, Date.now() + MINT_AUDIT_DETAIL_TTL_MS)).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    await readMintAuditDetail('https://other.example', {
      held: undefined,
      disabledAuditors: [],
      enabledAuditors: [],
      signal: aborted.signal,
      deps: deps(),
    });
    expect(mintAuditDetailDue('https://other.example', Date.now())).toBe(true);
  });

  it('discovery never calls a per-mint detail endpoint (no N+1)', async () => {
    const urls: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          mints: [
            { id: 1, url: 'https://a.example', state: 'OK', n_mints: 1, n_melts: 1, n_errors: 0 },
            { id: 2, url: 'https://b.example', state: 'OK', n_mints: 1, n_melts: 1, n_errors: 0 },
          ],
          total: 2,
        })
      );
    });
    const res = await discoverMintsFromAuditors({
      disabledAuditors: ['nip87', 'mintradar', 'cashu-audit', 'imf-gg'],
      enabledAuditors: ['macadamia'],
    });
    expect(res.isOk()).toBe(true);
    expect(urls.every((url) => url.includes('/api/search_mints'))).toBe(true);
    expect(urls.some((url) => url.includes('auditor.ucash.space'))).toBe(true);
    expect(urls.some((url) => url.includes('auditor.regtest.macadamia.cash'))).toBe(true);
  });
});
