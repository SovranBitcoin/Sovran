/**
 * @jest-environment node
 */

import {
  notifyNearbyNeedsConnection,
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

describe('nearby payment notices', () => {
  beforeEach(() => mockPopup.mockClear());

  it.each([
    ['near-pay-needs-connection-ok', () => notifyNearbyNeedsConnection()],
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
});
