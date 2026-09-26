/**
 * @jest-environment node
 */

import {
  confirmBearerDowngrade,
  notifyNoSharedMint,
  notifyNutDropNeedsBitcoinAccount,
  notifyNutDropPeerNotReady,
} from '@/features/nearPay/lib/startNearPaySend';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';

jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: jest.fn(),
}));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({ actionMenuSheet: jest.fn() }));

const mockPopup = jest.mocked(actionMenuSheet);

function latestConfig() {
  const config = mockPopup.mock.calls.at(-1)?.[0];
  if (!config) throw new Error('action menu was not opened');
  return config;
}

describe('confirmBearerDowngrade', () => {
  beforeEach(() => mockPopup.mockClear());

  it.each([
    ['near-pay-no-shared-mint-ok', () => notifyNoSharedMint('Alice')],
    ['near-pay-needs-bitcoin-account-ok', () => notifyNutDropNeedsBitcoinAccount()],
    ['near-pay-peer-not-ready-ok', () => notifyNutDropPeerNotReady('Alice')],
  ] as const)('puts notice %s in the modal-safe sheet', async (testID, notify) => {
    const decision = notify();
    const config = latestConfig();
    expect(config.buttons[0].testID).toBe(testID);
    config.onDismiss?.();
    await expect(decision).resolves.toBeUndefined();
  });

  it('resolves true only from the explicit Send unlocked action', async () => {
    const decision = confirmBearerDowngrade('Alice');
    const config = latestConfig();
    const send = config.buttons?.find((button) => button.testID === 'near-pay-bearer-consent-send');
    const close = jest.fn();

    await send?.onPress?.(close);

    await expect(decision).resolves.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resolves false from the explicit Cancel action', async () => {
    const decision = confirmBearerDowngrade('Alice');
    const config = latestConfig();
    const cancel = config.buttons?.find(
      (button) => button.testID === 'near-pay-bearer-consent-cancel'
    );

    await cancel?.onPress?.(jest.fn());

    await expect(decision).resolves.toBe(false);
  });

  it('fails closed when the sheet is dismissed', async () => {
    const decision = confirmBearerDowngrade('Alice');

    latestConfig().onDismiss?.();

    await expect(decision).resolves.toBe(false);
  });

  it('settles only once when callbacks race', async () => {
    const decision = confirmBearerDowngrade('Alice');
    const config = latestConfig();
    const send = config.buttons?.find((button) => button.testID === 'near-pay-bearer-consent-send');

    await send?.onPress?.(jest.fn());
    config.onDismiss?.();

    await expect(decision).resolves.toBe(true);
  });
});
