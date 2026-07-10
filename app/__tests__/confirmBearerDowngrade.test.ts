/**
 * @jest-environment node
 */

import { confirmBearerDowngrade } from '@/features/nearPay/lib/startNearPaySend';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';

jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: jest.fn(),
}));

const mockPopup = actionMenuPopup as jest.MockedFunction<typeof actionMenuPopup>;

function latestConfig() {
  const config = mockPopup.mock.calls.at(-1)?.[0];
  if (!config) throw new Error('action menu was not opened');
  return config;
}

describe('confirmBearerDowngrade', () => {
  beforeEach(() => mockPopup.mockClear());

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
