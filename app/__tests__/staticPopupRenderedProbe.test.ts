/**
 * @jest-environment node
 */

/* eslint-disable import/first -- popup dependencies must be mocked before registry import */

const mockPopup = jest.fn();

jest.mock('@/shared/lib/popup/popups/engine', () => ({
  popup: (config: unknown) => mockPopup(config),
}));

jest.mock('liquid-glass-text', () => ({
  LiquidGlassText: 'LiquidGlassText',
  isSupported: () => false,
}));

jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/shared/lib/popup/popups/copy', () => ({}));
jest.mock('@/shared/lib/popup/popups/actionSheets', () => ({}));
jest.mock('@/shared/lib/popup/popups/paymentOptionsSheet', () => ({}));
jest.mock('@/shared/lib/popup/popups/proofSelectorSheet', () => ({}));
jest.mock('@/shared/lib/popup/popups/sendMemoSheet', () => ({}));
jest.mock('@/shared/lib/popup/popups/emojiPicker', () => ({}));
jest.mock('@/shared/lib/popup/popups/modelPicker', () => ({}));
jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({}));
jest.mock('@/shared/lib/popup/popups/deleteStatus', () => ({}));
jest.mock('@/shared/lib/popup/popups/payment', () => ({}));

import { staticPopup } from '@/shared/lib/popup/popups';

describe('static popup rendered probe contract', () => {
  beforeEach(() => mockPopup.mockClear());

  it('passes only the closed key to the toast render bridge', () => {
    staticPopup('token-pending-not-redeemed');

    expect(mockPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        e2eProbeKey: 'token-pending-not-redeemed',
        message: expect.any(String),
      })
    );
    expect(mockPopup.mock.calls[0]?.[0]).not.toHaveProperty('token');
  });
});
