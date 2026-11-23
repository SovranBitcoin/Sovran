import {
  CASHU_AUDIT_LIST_URL,
  collectMintRadarWarnings,
  fetchCashuAuditDirectory,
  fetchImfDirectory,
  fetchMintRadarDirectory,
  fetchMintRadarSingle,
  IMF_LIST_URL,
  MINTRADAR_LIST_URL,
  parseNut06InfoJson,
} from '@/shared/lib/cashu/auditors/adapters';
import {
  discoverMintsFromAuditors,
  fetchMintAuditSummary,
  mergeAuditorEntries,
} from '@/shared/lib/cashu/auditors/discoverMints';
import {
  HTTP_MINT_AUDITOR_IDS,
  resolveEnabledAuditors,
} from '@/shared/lib/cashu/auditors/registry';

jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => null,
}));

jest.mock('@/shared/lib/logger', () => ({
  apiLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('mint auditor registry & privacy controls', () => {
  it('enables all auditors by default and filters disabled ids', () => {
    expect(resolveEnabledAuditors([])).toEqual(['nip87', 'mintradar', 'cashu-audit', 'imf-gg']);
    expect(resolveEnabledAuditors(['mintradar', 'imf-gg'])).toEqual(['nip87', 'cashu-audit']);
  });

  it('makes ZERO HTTP fetch calls when all HTTP auditors are disabled', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const nip87 = jest.fn(async () => [
      {
        source: 'nip87' as const,
        mintUrl: 'https://mint.example.com',
        name: 'Example Mint',
        supportedUnits: ['sat'],
      },
    ]);

    const res = await discoverMintsFromAuditors({
      disabledAuditors: [...HTTP_MINT_AUDITOR_IDS],
      adapters: { nip87 },
    });

    expect(res.isOk()).toBe(true);
    expect(nip87).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    const single = await fetchMintAuditSummary('https://mint.example.com', {
      disabledAuditors: [...HTTP_MINT_AUDITOR_IDS],
    });
    expect(single).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mint auditor adapters', () => {
  it('parses MintRadar directory and collects typed warnings', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          mints: [
            {
              url: 'https://mint.minibits.cash/Bitcoin',
              name: 'Minibits',
              status: 'online',
              score: 96,
              uptime30dPct: 99.5,
              units: ['sat'],
              audit: { swaps7d: 50, attributedFailures: 1 },
            },
            {
              url: 'https://broken.example',
              name: 'Broken',
              status: 'offline',
              uptime30dPct: 40,
              mintDisabled: true,
              meltDisabled: true,
              outdated: true,
              software: 'nutshell/0.14',
              isTest: true,
              audit: { swaps7d: 20, attributedFailures: 10 },
            },
          ],
        })
      )
    );

    const entries = await fetchMintRadarDirectory();
    expect(fetchSpy).toHaveBeenCalledWith(MINTRADAR_LIST_URL, expect.any(Object));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      source: 'mintradar',
      mintUrl: 'https://mint.minibits.cash/Bitcoin',
      state: 'OK',
      status: 'online',
      nMints: 49,
      nErrors: 1,
    });
    expect(entries[1].warnings?.map((w) => w.code)).toEqual([
      'offline',
      'lowUptime',
      'lowSuccessRate',
      'mintDisabled',
      'meltDisabled',
      'outdated',
      'testMint',
    ]);
  });

  it('parses MintRadar single-mint summary', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          mint: {
            url: 'https://mint.macadamia.cash',
            status: 'online',
            score: 92,
            uptime24hPct: 100,
            uptime7dPct: 99.8,
            uptime30dPct: 99.2,
            latency24h: { p50Ms: 145 },
            audit: { swaps7d: 30, attributedFailures: 0 },
          },
        })
      )
    );

    const summary = await fetchMintRadarSingle('https://mint.macadamia.cash');
    expect(summary).toMatchObject({
      mintUrl: 'https://mint.macadamia.cash',
      status: 'online',
      score: 92,
      latencyMs: 145,
      swaps: { okCount: 30, totalCount: 30 },
      warnings: [],
      sources: ['mintradar'],
    });
  });

  it('parses legacy Cashu Auditor (8333.space) and NUT-06 info JSON', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 1,
            url: 'https://mint.cubabitcoin.org',
            name: '"Cuba Bitcoin"',
            state: 'OK',
            n_mints: 120,
            n_melts: 80,
            n_errors: 2,
            info: JSON.stringify({
              name: 'Cuba Bitcoin',
              description: 'Community mint',
              icon_url: 'https://mint.cubabitcoin.org/icon.png',
              contact: [{ method: 'nostr', info: 'npub1example' }],
              nuts: {
                '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
              },
            }),
          },
        ])
      )
    );

    const entries = await fetchCashuAuditDirectory();
    expect(fetchSpy).toHaveBeenCalledWith(CASHU_AUDIT_LIST_URL, expect.any(Object));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'cashu-audit',
      name: 'Cuba Bitcoin',
      description: 'Community mint',
      iconUrl: 'https://mint.cubabitcoin.org/icon.png',
      operatorPubkey: 'npub1example',
      supportedUnits: ['sat'],
      nMints: 120,
      nMelts: 80,
      nErrors: 2,
    });
  });

  it('parses IMF.gg review directory', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          mints: [
            {
              id: 'abc',
              url: 'https://mint.minibits.cash/Bitcoin/',
              name: 'Minibits',
              reviewCount: 42,
              reviewAvg: 4.8,
            },
          ],
          total: 1,
        })
      )
    );

    const entries = await fetchImfDirectory();
    expect(fetchSpy).toHaveBeenCalledWith(IMF_LIST_URL, expect.any(Object));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'imf-gg',
      reviewCount: 42,
      averageScore: 4.8,
    });
  });

  it('handles malformed NUT-06 info gracefully', () => {
    expect(parseNut06InfoJson('not-json')).toEqual({});
    expect(parseNut06InfoJson(null)).toEqual({});
  });

  it('flags archived status without duplicating offline warning', () => {
    const warnings = collectMintRadarWarnings({ url: 'https://old.mint' }, 'archived');
    expect(warnings).toEqual([{ code: 'archived' }]);
  });
});

describe('multi-auditor merging and fault tolerance', () => {
  it('merges duplicate URLs across auditors (case/trailing-slash normalized) and ranks healthy mints first', () => {
    const merged = mergeAuditorEntries([
      {
        source: 'mintradar',
        mintUrl: 'https://mint.minibits.cash/Bitcoin',
        name: 'Minibits',
        status: 'online',
        state: 'OK',
        supportedUnits: ['sat'],
      },
      {
        source: 'imf-gg',
        mintUrl: 'https://mint.minibits.cash/bitcoin/',
        reviewCount: 50,
        averageScore: 4.9,
      },
      {
        source: 'cashu-audit',
        mintUrl: 'https://dead.example',
        name: 'Dead Mint',
        status: 'offline',
        state: 'ERROR',
        nMints: 0,
        nErrors: 10,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].mintUrl).toBe('https://mint.minibits.cash/Bitcoin');
    expect(merged[0].reviewCount).toBe(50);
    expect(merged[0].averageScore).toBe(4.9);
    expect(merged[1].mintUrl).toBe('https://dead.example');
  });

  it('succeeds when one auditor throws and others respond', async () => {
    const res = await discoverMintsFromAuditors({
      adapters: {
        nip87: async () => {
          throw new Error('relay offline');
        },
        mintradar: async () => [
          {
            source: 'mintradar',
            mintUrl: 'https://mint.macadamia.cash',
            name: 'Macadamia',
            status: 'online',
            state: 'OK',
          },
        ],
        'cashu-audit': async () => [],
        'imf-gg': async () => [],
      },
    });

    expect(res.isOk()).toBe(true);
    if (res.isOk()) {
      expect(res.value.mints).toHaveLength(1);
      expect(res.value.mints[0].name).toBe('Macadamia');
    }
  });
});
