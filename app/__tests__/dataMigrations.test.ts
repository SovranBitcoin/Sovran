import { storeLog } from '@/shared/lib/logger';
import { runDataMigrations } from '@/shared/lib/migrations/dataMigrations';
import { useDataMigrationStore } from '@/shared/stores/profile/dataMigrationStore';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { useTransactionLocationStore } from '@/shared/stores/profile/transactionLocationStore';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';

let mockActivePubkey = 'profile-a';
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ getActiveProfile: () => ({ pubkey: mockActivePubkey }) }) },
}));

const mockWrite = jest.fn(async (_name: string, _value: string) => {});

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: (name: string, value: string) => mockWrite(name, value),
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { warn: jest.fn() },
}));

const stores = [
  useDataMigrationStore,
  useTransactionAnnotationStore,
  useScanHistoryStore,
  useTransactionDistributionStore,
  useTransactionLocationStore,
  useSwapTransactionsStore,
];

describe('v0.1.0 transaction side-data migration', () => {
  beforeEach(async () => {
    mockActivePubkey = 'profile-a';
    mockWrite.mockReset().mockResolvedValue(undefined);
    jest.mocked(storeLog.warn).mockClear();
    await Promise.all(stores.map((store) => store.persist.rehydrate()));
    useDataMigrationStore.setState({ level: 0 });
    useTransactionAnnotationStore.setState({ annotations: {} });
    useScanHistoryStore.setState({ entries: [], entriesByTransactionId: {} });
    useTransactionDistributionStore.setState({ distributions: {} });
    useTransactionLocationStore.setState({ locations: {} });
    useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });
  });

  afterEach(() => jest.restoreAllMocks());

  it('imports all four released side-data stores into annotation keys', async () => {
    useScanHistoryStore.setState({
      entries: [
        {
          id: 'scan-1',
          raw: 'lnbc1fixture',
          type: 'lightning',
          source: 'qr',
          scannedAt: 1,
          transactionId: 'tx-1',
          container: 'lightning',
          optionKinds: ['lightningInvoice'],
          inputType: 'payment',
        },
      ],
    });
    useTransactionDistributionStore.setState({
      distributions: { 'quote-1': { source: 'copy', recordedAt: 1 } },
    });
    useTransactionLocationStore.setState({
      locations: { 'tx-1': { latitude: 0, longitude: 0, createdAt: 1 } },
    });
    useSwapTransactionsStore.setState({
      quoteIdToGroup: { 'quote-1': { groupId: 'swap-1', legId: 'leg-1', kind: 'mint' } },
    });

    await runDataMigrations();

    expect(jest.mocked(storeLog.warn).mock.calls).toEqual([]);
    expect(useTransactionAnnotationStore.getState().annotations).toEqual({
      'id:tx-1': {
        scanMethod: 'qr',
        scanRaw: 'lnbc1fixture',
        scanContainer: 'lightning',
        scanOptionKinds: '["lightningInvoice"]',
        scanInputType: 'payment',
        geoLat: '0',
        geoLng: '0',
      },
      'quote:quote-1': { distributionSource: 'copy', swapGroupId: 'swap-1', swapRole: 'mint' },
      'id:quote-1': { distributionSource: 'copy' },
    });
    expect(useDataMigrationStore.getState().level).toBe(1);
  });

  it('fills missing fields without overwriting annotations already recorded by the current app', async () => {
    useTransactionDistributionStore.setState({
      distributions: { 'quote-1': { source: 'displayed', recordedAt: 1 } },
    });
    useTransactionAnnotationStore.setState({
      annotations: {
        'quote:quote-1': { distributionSource: 'airdrop', counterpartyPubkey: 'fixture' },
      },
    });
    await runDataMigrations();
    expect(useTransactionAnnotationStore.getState().annotations['quote:quote-1']).toEqual({
      distributionSource: 'airdrop',
      counterpartyPubkey: 'fixture',
    });
    expect(useTransactionAnnotationStore.getState().annotations['id:quote-1']).toEqual({
      distributionSource: 'displayed',
    });
  });

  it('retries a failed real import instead of marking it complete', async () => {
    const read = jest.spyOn(useScanHistoryStore, 'getState').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    await runDataMigrations();
    expect(useDataMigrationStore.getState().level).toBe(0);
    read.mockRestore();
    await runDataMigrations();
    expect(useDataMigrationStore.getState().level).toBe(1);
  });

  it('does not reread old stores after completing the import', async () => {
    await runDataMigrations();
    const read = jest.spyOn(useScanHistoryStore, 'getState');
    await runDataMigrations();
    expect(read).not.toHaveBeenCalled();
  });
  it('waits for durable annotations before writing the completion level', async () => {
    let finishWrite: () => void = () => {
      throw new Error('write not started');
    };
    const pendingWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    let started: () => void = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mockWrite.mockImplementationOnce(() => {
      started();
      return pendingWrite;
    });
    const migration = runDataMigrations();
    await writeStarted;
    // Let the runner finish if it incorrectly skips awaiting the pending write.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useDataMigrationStore.getState().level).toBe(0);
    finishWrite();
    await migration;
    expect(useDataMigrationStore.getState().level).toBe(1);
  });

  it('does not checkpoint another profile after a delayed annotation write', async () => {
    let finishWrite = () => {};
    let started = () => {};
    const pendingWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mockWrite.mockClear().mockImplementationOnce(() => {
      started();
      return pendingWrite;
    });
    const migration = runDataMigrations();
    await writeStarted;
    mockActivePubkey = 'profile-b';
    finishWrite();
    await migration;
    expect(useDataMigrationStore.getState().level).toBe(0);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('leaves the migration pending when its annotation write rejects', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    await runDataMigrations();
    expect(useDataMigrationStore.getState().level).toBe(0);
    await runDataMigrations();
    expect(useDataMigrationStore.getState().level).toBe(1);
  });
});
