/**
 * @jest-environment node
 */

import { maybeExportSeedForE2E } from '@/shared/lib/nostr/e2eSeedExport';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TOKEN = 'a'.repeat(64);

describe('funded E2E seed export', () => {
  it('posts only to the authenticated owned loopback endpoint without logging the mnemonic', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }));
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeExportSeedForE2E(MNEMONIC, {
      enabled: true,
      endpoint: 'http://127.0.0.1:43210/seed',
      token: TOKEN,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:43210/seed',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-sovran-e2e-token': TOKEN }),
        body: MNEMONIC,
      })
    );
    expect(consoleLog).not.toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('does nothing outside the gated run and rejects non-owned configuration', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }));
    await maybeExportSeedForE2E(MNEMONIC, { enabled: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      maybeExportSeedForE2E(MNEMONIC, {
        enabled: true,
        endpoint: 'https://example.com/seed',
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow('invalid funded E2E seed-export endpoint');
    await expect(
      maybeExportSeedForE2E(MNEMONIC, {
        enabled: true,
        endpoint: 'http://127.0.0.1:43210/seed',
        token: 'short',
        fetchImpl,
      })
    ).rejects.toThrow('invalid funded E2E seed-export configuration');
  });
});
