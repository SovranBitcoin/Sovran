import { ensureTrustedDefaultMint } from '@/shared/lib/cashu/defaultMintInitialization';

const MINT = 'https://mint.minibits.cash/Bitcoin';

describe('ensureTrustedDefaultMint', () => {
  it('leaves an already trusted mint untouched', async () => {
    const mint = {
      isTrustedMint: jest.fn(async () => true),
      addMint: jest.fn(async () => ({})),
    };

    await expect(ensureTrustedDefaultMint(mint, MINT)).resolves.toEqual({
      status: 'already-trusted',
      attempts: 1,
    });
    expect(mint.addMint).not.toHaveBeenCalled();
  });

  it('retries one rejected add and still requires trusted add semantics', async () => {
    const sleep = jest.fn(async () => {});
    const mint = {
      isTrustedMint: jest.fn(async () => false),
      addMint: jest
        .fn<Promise<unknown>, [string, { trusted: true }]>()
        .mockRejectedValueOnce(new Error('temporary TLS failure'))
        .mockResolvedValueOnce({}),
    };

    await expect(
      ensureTrustedDefaultMint(mint, MINT, { retryDelayMs: 25, sleep })
    ).resolves.toEqual({ status: 'added', attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(25);
    expect(mint.addMint).toHaveBeenNthCalledWith(1, MINT, { trusted: true });
    expect(mint.addMint).toHaveBeenNthCalledWith(2, MINT, { trusted: true });
  });

  it('observes a trusted mint before retrying a possibly late add', async () => {
    const mint = {
      isTrustedMint: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      addMint: jest.fn(async () => {
        throw new Error('response failed after persistence');
      }),
    };

    await expect(ensureTrustedDefaultMint(mint, MINT, { sleep: async () => {} })).resolves.toEqual({
      status: 'already-trusted',
      attempts: 2,
    });
    expect(mint.addMint).toHaveBeenCalledTimes(1);
  });

  it('times out a hung attempt instead of blocking forever, then fails closed', async () => {
    const mint = {
      isTrustedMint: jest.fn(async () => false),
      addMint: jest.fn(() => new Promise<unknown>(() => {})),
    };

    await expect(
      ensureTrustedDefaultMint(mint, MINT, {
        attempts: 2,
        attemptTimeoutMs: 25,
        sleep: async () => {},
      })
    ).rejects.toThrow('default mint attempt timed out after 25ms');
    expect(mint.addMint).toHaveBeenCalledTimes(2);
  });

  it('fails after the bounded attempts without trusting by fallback', async () => {
    const mint = {
      isTrustedMint: jest.fn(async () => false),
      addMint: jest.fn(async () => {
        throw new Error('mint unavailable');
      }),
    };

    await expect(
      ensureTrustedDefaultMint(mint, MINT, { attempts: 2, sleep: async () => {} })
    ).rejects.toThrow('mint unavailable');
    expect(mint.addMint).toHaveBeenCalledTimes(2);
  });
});
