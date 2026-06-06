import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  startBLE,
  addBLEDeliveryStatusListener,
  addBLEPrivateMessageListener,
} from 'bitchat-module';

import { BitchatBLEProvider } from '@/shared/providers/BitchatBLEProvider';

jest.mock('bitchat-module', () => ({
  startBLE: jest.fn(),
  addBLEDeliveryStatusListener: jest.fn(() => ({ remove: jest.fn() })),
  addBLEPrivateMessageListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockAppendIncoming = jest.fn();
const mockApplyDeliveryStatus = jest.fn();

jest.mock('@/features/bitchat/stores/bitchatDmMessages', () => ({
  useBitchatDmMessagesStore: {
    getState: jest.fn(() => ({
      appendIncoming: mockAppendIncoming,
      applyDeliveryStatus: mockApplyDeliveryStatus,
    })),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  bitchatLog: {
    info: jest.fn(),
    error: jest.fn(),
  },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
}));

describe('BitchatBLEProvider startup', () => {
  it('mounts DM listeners without starting BLE discovery', async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        <BitchatBLEProvider>
          <></>
        </BitchatBLEProvider>
      );
    });

    expect(startBLE).not.toHaveBeenCalled();
    expect(addBLEPrivateMessageListener).toHaveBeenCalledTimes(1);
    expect(addBLEDeliveryStatusListener).toHaveBeenCalledTimes(1);

    renderer?.unmount();
  });
});
