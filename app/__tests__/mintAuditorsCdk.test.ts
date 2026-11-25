/**
 * The CDK auditors (uCash, Macadamia), the imf.gg fix and the opt-in toggle.
 * Response bodies are trimmed copies of what the live hosts served on
 * 2026-11-24 (`search_mints`, `get_mint_uptime`, `get_mint_metrics`,
 * `imf.gg/api/mints?page=N`).
 */
import {
  AUDITOR_MAX_PAGES,
  cdkDetailObservation,
  fetchCdkDirectory,
  fetchCdkMintMetrics,
  fetchCdkMintUptime,
  fetchImfDirectory,
  findCdkMint,
} from '@/shared/lib/cashu/auditors/adapters';
import { mergeAuditorEntries } from '@/shared/lib/cashu/auditors/discoverMints';
import {
  isAuditorEnabled,
  MINT_AUDITORS,
  resolveEnabledAuditors,
} from '@/shared/lib/cashu/auditors/registry';

jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: () => null }));
jest.mock('@/shared/lib/logger', () => ({
  apiLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SUFFIX = '5929181479826419594';

const MINIBITS_INFO = JSON.stringify({
  name: 'Minibits mint',
  nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } },
  contact: [{ method: 'email', info: 'support@minibits.cash' }],
});

function cdkRow(id: number, url: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    url,
    info: MINIBITS_INFO,
    name: 'Minibits mint',
    state: 'OK',
    n_errors: 17,
    n_mints: 61,
    n_melts: 50,
    ...extra,
  };
}

type Call = { url: string; body?: string; method?: string; contentType?: string };

/** A fetch stand-in that records each request and answers from `respond`. */
function mockFetch(respond: (call: Call) => unknown | Response) {
  const calls: Call[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
      method: init?.method,
      contentType: headers['Content-Type'],
    };
    calls.push(call);
    const answer = respond(call);
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer));
  });
  return calls;
}

afterEach(() => jest.restoreAllMocks());

describe('auditor registry: uCash on, Macadamia opt-in', () => {
  it('declares both CDK auditors with the Leptos suffix', () => {
    const ucash = MINT_AUDITORS.find((a) => a.id === 'ucash');
    const macadamia = MINT_AUDITORS.find((a) => a.id === 'macadamia');
    expect(ucash).toMatchObject({
      name: 'uCash Auditor',
      endpoint: 'https://auditor.ucash.space',
      functionSuffix: SUFFIX,
      defaultEnabled: true,
    });
    expect(macadamia).toMatchObject({
      name: 'Macadamia Auditor',
      endpoint: 'https://auditor.regtest.macadamia.cash',
      functionSuffix: SUFFIX,
      defaultEnabled: false,
    });
    expect(macadamia?.description).toMatch(/regtest/);
    expect(macadamia?.description).toMatch(/mainnet/);
  });

  it('keeps a default-off auditor off for an install that only ever saved the denylist', () => {
    // An install from before Macadamia existed: denylist saved, allowlist absent.
    expect(resolveEnabledAuditors(['mintradar'])).not.toContain('macadamia');
    expect(resolveEnabledAuditors(['mintradar'], [])).not.toContain('macadamia');
    // Not even a stray id in the denylist turns it on.
    expect(resolveEnabledAuditors(['macadamia'])).not.toContain('macadamia');
  });

  it('runs a default-off auditor only from the allowlist, and the denylist still governs the rest', () => {
    expect(resolveEnabledAuditors([], ['macadamia'])).toContain('macadamia');
    expect(isAuditorEnabled('macadamia', [], ['macadamia'])).toBe(true);
    expect(isAuditorEnabled('macadamia', [], [])).toBe(false);
    // The allowlist cannot re-enable a default-on auditor the person turned off.
    expect(isAuditorEnabled('ucash', ['ucash'], ['ucash'])).toBe(false);
    expect(isAuditorEnabled('ucash', [], [])).toBe(true);
  });
});

describe('CDK directory (search_mints)', () => {
  it('POSTs form-encoded 0-indexed pages to the suffixed route and stops at total', async () => {
    const calls = mockFetch((call) => {
      const page = Number(/page=(\d+)/.exec(call.body ?? '')?.[1]);
      if (page === 0) {
        return {
          mints: [
            cdkRow(1, 'https://m7.mountainlake.io'),
            cdkRow(2, 'https://mint.minibits.cash/Bitcoin'),
          ],
          total: 3,
        };
      }
      if (page === 1) {
        // A repeat of page 0's row (servers shift under paging) and one new.
        return {
          mints: [
            cdkRow(2, 'https://mint.minibits.cash/Bitcoin/'),
            cdkRow(4, 'https://mint.macadamia.cash'),
          ],
          total: 3,
        };
      }
      throw new Error(`unexpected page ${page}`);
    });

    const entries = await fetchCdkDirectory('macadamia');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: `https://auditor.regtest.macadamia.cash/api/search_mints${SUFFIX}`,
      method: 'POST',
      body: 'search=&page=0',
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(calls[1].body).toBe('search=&page=1');
    expect(entries.map((e) => e.mintUrl)).toEqual([
      'https://m7.mountainlake.io',
      'https://mint.minibits.cash/Bitcoin',
      'https://mint.macadamia.cash',
    ]);
    expect(entries[1]).toMatchObject({
      source: 'macadamia',
      name: 'Minibits mint',
      state: 'OK',
      nMints: 61,
      nMelts: 50,
      nErrors: 17,
      observation: {
        source: 'macadamia',
        status: 'online',
        operations: { okCount: 111, totalCount: 128, window: 'all' },
        auditorMintId: 2,
      },
    });
  });

  it('never classifies a mint as a test mint from the auditor hostname', async () => {
    mockFetch(() => ({ mints: [cdkRow(2, 'https://mint.minibits.cash/Bitcoin')], total: 1 }));
    const [entry] = await fetchCdkDirectory('macadamia');
    expect(entry.testnut).toBeUndefined();
    const [merged] = mergeAuditorEntries([entry]);
    expect(merged.testnut).toBeUndefined();
  });

  it('stops after AUDITOR_MAX_PAGES when a server keeps sending new rows', async () => {
    let n = 0;
    const calls = mockFetch(() => ({
      mints: [cdkRow(++n, `https://mint${n}.example`)],
      total: 10_000,
    }));
    const entries = await fetchCdkDirectory('ucash');
    expect(calls).toHaveLength(AUDITOR_MAX_PAGES);
    expect(entries).toHaveLength(AUDITOR_MAX_PAGES);
  });

  it('stops when a server ignores the page parameter and repeats itself', async () => {
    const calls = mockFetch(() => ({ mints: [cdkRow(1, 'https://same.example')], total: 50 }));
    const entries = await fetchCdkDirectory('ucash');
    expect(calls).toHaveLength(2);
    expect(entries).toHaveLength(1);
  });

  it('fails the source when page 0 fails, keeps what it read when a later page fails', async () => {
    mockFetch(() => new Response('{}', { status: 502 }));
    await expect(fetchCdkDirectory('ucash')).rejects.toThrow('ucash HTTP 502');

    jest.restoreAllMocks();
    mockFetch((call) =>
      call.body?.includes('page=0')
        ? { mints: [cdkRow(1, 'https://one.example')], total: 2 }
        : new Response('nope', { status: 500 })
    );
    const entries = await fetchCdkDirectory('ucash');
    expect(entries.map((e) => e.mintUrl)).toEqual(['https://one.example']);
  });

  it('honours an aborted signal before asking for another page', async () => {
    const controller = new AbortController();
    const calls = mockFetch(() => {
      controller.abort();
      return { mints: [cdkRow(1, 'https://one.example')], total: 5 };
    });
    await expect(fetchCdkDirectory('ucash', { signal: controller.signal })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('carries each source reading through the merge, by source', () => {
    const merged = mergeAuditorEntries([
      {
        source: 'ucash',
        mintUrl: 'https://mint.minibits.cash/Bitcoin',
        observation: {
          source: 'ucash',
          observedAt: 1,
          operations: { okCount: 9, totalCount: 10, window: 'all' },
          auditorMintId: 2,
        },
      },
      {
        source: 'macadamia',
        mintUrl: 'https://mint.minibits.cash/Bitcoin/',
        observation: {
          source: 'macadamia',
          observedAt: 1,
          operations: { okCount: 1, totalCount: 4, window: 'all' },
          auditorMintId: 7,
        },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].hasAudit).toBe(true);
    expect(merged[0].auditObservations?.ucash?.auditorMintId).toBe(2);
    expect(merged[0].auditObservations?.macadamia?.operations).toEqual({
      okCount: 1,
      totalCount: 4,
      window: 'all',
    });
  });
});

describe('CDK per-mint detail (lazy, by auditor mint id)', () => {
  it('POSTs id= to get_mint_uptime and get_mint_metrics and parses both', async () => {
    const calls = mockFetch((call) =>
      call.url.includes('get_mint_uptime')
        ? {
            window_hours: 24,
            bucket_minutes: 60,
            checks: 25,
            successes: 25,
            failures: 0,
            uptime_percent: 100.0,
            bars: [],
          }
        : {
            attempts: 408,
            successes: 230,
            attempts_24h: 4,
            successes_24h: 3,
            avg_latency_ms: 3426.236083804348,
            avg_latency_ms_24h: 3393.953227,
          }
    );
    const uptime = await fetchCdkMintUptime('ucash', 2);
    const metrics = await fetchCdkMintMetrics('ucash', 2);
    expect(calls.map((c) => [c.url, c.body, c.method])).toEqual([
      [`https://auditor.ucash.space/api/get_mint_uptime${SUFFIX}`, 'id=2', 'POST'],
      [`https://auditor.ucash.space/api/get_mint_metrics${SUFFIX}`, 'id=2', 'POST'],
    ]);
    expect(cdkDetailObservation('ucash', { uptime, metrics }, 5)).toEqual({
      source: 'ucash',
      observedAt: 5,
      uptime: { pct: 100, window: '24h', checks: 25 },
      latency: { ms: 3393.953227, kind: 'mean', window: '24h' },
    });
  });

  it('ignores the 0.0 24h latency both hosts send when no probe succeeded in 24h', () => {
    const update = cdkDetailObservation(
      'macadamia',
      {
        metrics: {
          attempts: 50,
          successes: 40,
          attempts_24h: 3,
          successes_24h: 0,
          avg_latency_ms: 812.5,
          avg_latency_ms_24h: 0.0,
        },
      },
      1
    );
    // Falls back to the all-time mean, labelled as such, never "0 ms (24h)".
    expect(update.latency).toEqual({ ms: 812.5, kind: 'mean', window: 'all' });
  });

  it('clears latency when nothing ever succeeded, and uptime when no check ran', () => {
    const update = cdkDetailObservation(
      'ucash',
      {
        uptime: { checks: 0, uptime_percent: 0 },
        metrics: {
          attempts: 3,
          successes: 0,
          successes_24h: 0,
          avg_latency_ms: 0,
          avg_latency_ms_24h: 0,
        },
      },
      1
    );
    expect(update.uptime).toBeNull();
    expect(update.latency).toBeNull();
  });

  it('treats 404, 5xx and schema mismatches as nothing from that source', async () => {
    mockFetch(() => new Response('not found', { status: 404 }));
    await expect(fetchCdkMintUptime('ucash', 99)).resolves.toBeUndefined();
    jest.restoreAllMocks();
    mockFetch(() => new Response('{}', { status: 503 }));
    await expect(fetchCdkMintMetrics('ucash', 99)).resolves.toBeUndefined();
    jest.restoreAllMocks();
    mockFetch(() => ({ checks: 'lots' }));
    await expect(fetchCdkMintUptime('ucash', 99)).resolves.toBeUndefined();
  });

  it('finds an unknown mint id with one host search', async () => {
    const calls = mockFetch(() => ({
      mints: [
        cdkRow(3, 'https://mint.minibits.cash/other'),
        cdkRow(2, 'https://mint.minibits.cash/Bitcoin'),
      ],
      total: 2,
    }));
    const found = await findCdkMint('ucash', 'https://mint.minibits.cash/Bitcoin/');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBe('search=mint.minibits.cash&page=0');
    expect(found?.observation?.auditorMintId).toBe(2);
  });
});

describe('imf.gg directory', () => {
  it('reads snake_case review fields, pages from 1 and de-duplicates by URL', async () => {
    const calls = mockFetch((call) => {
      const page = Number(new URL(call.url).searchParams.get('page'));
      if (page === 1) {
        return {
          mints: [
            {
              id: 'a',
              url: 'https://mint.lnserver.com',
              info: null,
              name: '',
              review_count: 12,
              review_avg: 3.5833,
            },
            {
              id: 'b',
              url: 'https://mint.minibits.cash/bitcoin',
              info: null,
              name: '',
              review_count: 0,
              review_avg: null,
            },
          ],
          total: 3,
        };
      }
      if (page === 2) {
        return {
          mints: [
            { id: 'a', url: 'https://mint.lnserver.com/', review_count: 12, review_avg: 3.5833 },
            { id: 'c', url: 'https://mint.0xchat.com', review_count: 1, review_avg: 1.0 },
          ],
          total: 3,
        };
      }
      return { mints: [], total: 3 };
    });

    const entries = await fetchImfDirectory();

    expect(calls.map((c) => c.url)).toEqual([
      'https://imf.gg/api/mints?page=1',
      'https://imf.gg/api/mints?page=2',
    ]);
    expect(entries.map((e) => [e.mintUrl, e.reviewCount, e.averageScore])).toEqual([
      ['https://mint.lnserver.com', 12, 3.5833],
      ['https://mint.minibits.cash/bitcoin', 0, undefined],
      ['https://mint.0xchat.com', 1, 1],
    ]);
  });

  it('stops on the first empty page when the total is missing', async () => {
    const calls = mockFetch((call) =>
      call.url.endsWith('page=1')
        ? { mints: [{ url: 'https://one.example', reviewCount: 2, reviewAvg: 4 }] }
        : { mints: [] }
    );
    const entries = await fetchImfDirectory();
    expect(calls).toHaveLength(2);
    expect(entries[0]).toMatchObject({ reviewCount: 2, averageScore: 4 });
  });
});
