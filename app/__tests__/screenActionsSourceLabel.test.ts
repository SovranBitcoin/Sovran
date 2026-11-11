/**
 * @jest-environment node
 *
 * The transaction screen's source label ("QR Code", "Clipboard", "Shared"...)
 * must agree with the transaction row, which reads the transaction's
 * annotations. Scan history keeps only the newest scans and skips very long
 * inputs, so it is only the fallback for what older builds recorded there.
 */

import type { Manager } from 'wallet';

import { createSovranScreenActionsBridge } from '@/features/send/lib/createSovranScreenActionsBridge';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import {
  setTransactionAnnotation,
  useTransactionAnnotationStore,
} from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

// Every event subscription the bridge makes is a no-op here.
const quietManager: unknown = { on: () => () => {} };

function createBridge() {
  return createSovranScreenActionsBridge({
    manager: quietManager as Manager,
    requestCameraPermission: async () => false,
    subscribeP2pkKeyRefreshed: () => () => {},
    subscribeOfflineChanged: () => () => {},
  });
}

function sourceLabel(entry: Record<string, unknown>): string | null {
  return createBridge().getSourceLabel?.(entry) ?? null;
}

beforeEach(() => {
  useTransactionAnnotationStore.setState({ annotations: {} });
  useScanHistoryStore.setState({ entries: [] });
  useTransactionDistributionStore.setState({ distributions: {} });
});

describe('transaction screen source label', () => {
  it('reads a scan the transaction annotation holds when scan history has none', () => {
    setTransactionAnnotation('id:tx-1', { scan: { method: 'paste' } });
    expect(sourceLabel({ id: 'tx-1', type: 'receive' })).toBe('Clipboard');
  });

  it('names a payment that arrived over Bluetooth', () => {
    setTransactionAnnotation('id:tx-2', { scan: { method: 'ble' } });
    expect(sourceLabel({ id: 'tx-2', type: 'receive' })).toBe('Bluetooth');
  });

  it('reads a mint quote shared as the annotation records it', () => {
    setTransactionAnnotation('quote:q-1', { distribution: { source: 'share' } });
    expect(sourceLabel({ id: 'mint-row', type: 'mint', quoteId: 'q-1' })).toBe('Shared');
  });

  it('falls back to scan history for a scanned receive', () => {
    const scans = useScanHistoryStore.getState();
    scans.addScan({ raw: 'cashuAfixture', type: 'ecash', source: 'qr' });
    scans.linkTransaction('cashuAfixture', 'tx-2');
    expect(sourceLabel({ id: 'tx-2', type: 'receive' })).toBe('QR Code');
  });

  it('falls back to the distribution store for a copied mint quote', () => {
    useTransactionDistributionStore.getState().setDistribution('q-2', 'copy');
    expect(sourceLabel({ id: 'mint-row', type: 'mint', quoteId: 'q-2' })).toBe('Copied');
  });

  it('shows nothing for a transaction with no recorded source', () => {
    expect(sourceLabel({ id: 'tx-3', type: 'send' })).toBeNull();
  });

  it('asks an open screen to read again when an annotation is written', () => {
    const publish = jest.fn();
    const unbind = createBridge().bindSubscriptionBus?.({
      publish,
      subscribe: () => () => {},
      subscribeAll: () => () => {},
    });
    setTransactionAnnotation('id:tx-4', { scan: { method: 'nfc' } });
    expect(publish).toHaveBeenCalledWith({
      type: 'screenActions.changed',
      reason: 'transactionAnnotation',
    });
    unbind?.();
  });
});
