import {
  releaseTrustWindow,
  formatStrandedRoutingDetail,
} from '@/features/mint/components/rebalance/releaseTrustWindow';

interface RecordedManager {
  manager: {
    wallet: { balances: { byMint: jest.Mock } };
    mint: { untrustMint: jest.Mock };
  };
  untrusted: string[];
}

function makeManager(opts: {
  balances?: Record<string, { total: number }>;
  balancesThrows?: boolean;
  untrustThrowsFor?: string;
}): RecordedManager {
  const untrusted: string[] = [];
  return {
    untrusted,
    manager: {
      wallet: {
        balances: {
          byMint: jest.fn(async () => {
            if (opts.balancesThrows) throw new Error('network');
            return opts.balances ?? {};
          }),
        },
      },
      mint: {
        untrustMint: jest.fn(async (url: string) => {
          if (opts.untrustThrowsFor === url) throw new Error('untrust failed');
          untrusted.push(url);
        }),
      },
    },
  };
}

describe('releaseTrustWindow (audit 12.json F-001 / F-003)', () => {
  it('untrusts every mint in the trust window even when balance is zero', async () => {
    const { manager, untrusted } = makeManager({
      balances: { 'https://a.example': { total: 0 }, 'https://b.example': { total: 0 } },
    });

    const result = await releaseTrustWindow(manager, ['https://a.example', 'https://b.example']);

    expect(untrusted).toEqual(['https://a.example', 'https://b.example']);
    expect(result.stranded).toEqual([]);
    expect(result.untrustErrors).toEqual([]);
  });

  it('always untrusts even when an intermediary still holds funds (F-003 fix)', async () => {
    const { manager, untrusted } = makeManager({
      balances: {
        'https://a.example': { total: 0 },
        'https://stranded.example': { total: 42 },
      },
    });

    const result = await releaseTrustWindow(manager, [
      'https://a.example',
      'https://stranded.example',
    ]);

    expect(untrusted).toEqual(['https://a.example', 'https://stranded.example']);
    expect(result.stranded).toEqual([{ url: 'https://stranded.example', balance: 42 }]);
  });

  it('treats a balance-fetch failure as zero balance and still untrusts everything', async () => {
    const { manager, untrusted } = makeManager({ balancesThrows: true });

    const result = await releaseTrustWindow(manager, ['https://a.example', 'https://b.example']);

    expect(untrusted).toEqual(['https://a.example', 'https://b.example']);
    expect(result.stranded).toEqual([]);
  });

  it('records untrust errors but keeps untrusting the remaining mints', async () => {
    const { manager, untrusted } = makeManager({
      balances: { 'https://a.example': { total: 0 }, 'https://b.example': { total: 0 } },
      untrustThrowsFor: 'https://a.example',
    });

    const result = await releaseTrustWindow(manager, ['https://a.example', 'https://b.example']);

    expect(untrusted).toEqual(['https://b.example']);
    expect(result.untrustErrors.map((e) => e.url)).toEqual(['https://a.example']);
  });

  it('is a no-op when no mints were temporarily trusted', async () => {
    const { manager } = makeManager({});

    await releaseTrustWindow(manager, []);

    expect(manager.wallet.balances.byMint).not.toHaveBeenCalled();
    expect(manager.mint.untrustMint).not.toHaveBeenCalled();
  });
});

describe('formatStrandedRoutingDetail', () => {
  it('extracts the domain and lists the balance for each stranded mint', () => {
    const message = formatStrandedRoutingDetail([
      { url: 'https://a.example/v1/', balance: 12 },
      { url: 'https://b.example/cashu', balance: 7 },
    ]);

    expect(message).toContain('a.example');
    expect(message).toContain('12 sat');
    expect(message).toContain('b.example');
    expect(message).toContain('7 sat');
    expect(message).toContain('re-trust');
  });
});
