import { describe, expect, it } from 'bun:test';

import { FakeDriver } from './driver';

describe('FakeDriver strict defaults', () => {
  it('fails waitFor when a selector is absent unless permissive smoke mode is explicit', async () => {
    await expect(new FakeDriver().waitFor({ label: 'Missing' }, 'visible', 1)).rejects.toThrow(
      /not present/
    );
    await expect(
      new FakeDriver({ permissive: true }).waitFor({ label: 'Missing' }, 'visible', 1)
    ).resolves.toMatchObject({ label: 'Missing' });
  });

  it('gives permissive id selectors a stable non-empty label for capture plumbing', async () => {
    const driver = new FakeDriver({ permissive: true });
    await expect(driver.find({ id: 'payment-info-address-data' })).resolves.toMatchObject({
      id: 'payment-info-address-data',
      label: 'payment-info-address-data',
    });
  });

  it('rejects disabled controls when enabled state is required', async () => {
    const driver = new FakeDriver({
      present: { 'label:Next': { label: 'Next', state: { enabled: false } } },
    });
    await expect(driver.waitFor({ label: 'Next' }, 'enabled', 1)).rejects.toThrow(/not enabled/);
  });

  it('throws for unconfigured balances instead of inventing zero', async () => {
    await expect(new FakeDriver().balance('usd')).rejects.toThrow(/unsupported.*usd/);
    await expect(new FakeDriver({ balances: { sat: 0 } }).balance('sat')).resolves.toBe(0);
  });

  it('returns atomic state frames with advancing revisions by default', async () => {
    const driver = new FakeDriver({
      currentState: 'wallet',
      present: { 'id:wallet-send': { id: 'wallet-send' } },
    });

    const first = await driver.observeState();
    const second = await driver.observeState();

    expect(first).toMatchObject({ state: 'wallet', revision: 1 });
    expect(first.ax).toEqual([{ id: 'wallet-send' }]);
    expect(second.revision).toBe(2);
  });

  it('returns the uniquely matched prefix node and rejects ambiguous capture matches', async () => {
    const unique = new FakeDriver({
      present: { 'id:send-token-id-abc': { id: 'send-token-id-abc' } },
    });
    await expect(
      unique.waitFor({ idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' }, 'visible', 1)
    ).resolves.toMatchObject({ id: 'send-token-id-abc' });

    const ambiguous = new FakeDriver({
      present: {
        'id:send-token-id-abc': { id: 'send-token-id-abc' },
        'id:send-token-id-def': { id: 'send-token-id-def' },
      },
    });
    await expect(
      ambiguous.waitFor({ idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' }, 'visible', 1)
    ).rejects.toThrow(/ambiguous.*send-token-id-/i);
  });
});
