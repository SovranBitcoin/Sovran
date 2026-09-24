import {
  createTransactionProbe,
  serializeTransactionProbe,
} from '@/features/transactions/lib/transactionProbe';

describe('transaction accessibility probe', () => {
  const entry = {
    id: 'receive-secret-id',
    type: 'receive' as const,
    amount: 50,
    unit: 'sat',
    mintUrl: 'https://Mint.Sovran.Money/private/path',
    state: 'finalized',
    token: 'cashuB-secret-token',
    paymentRequest: 'lnbc-secret-invoice',
    quoteId: 'secret-quote-id',
    metadata: { rawInput: 'secret-payment-payload' },
  };

  it('serializes only the safe structured fields consumed by device assertions', () => {
    expect(createTransactionProbe(entry, 'Paste')).toEqual({
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
      lock: 'none',
      reclaim: 'none',
    });

    const serialized = serializeTransactionProbe(entry, 'Paste');
    expect(JSON.parse(serialized)).toEqual({
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
      lock: 'none',
      reclaim: 'none',
    });
    expect(serialized).not.toContain('cashuB');
    expect(serialized).not.toContain('lnbc');
    expect(serialized).not.toContain('secret-id');
    expect(serialized).not.toContain('/private/path');
  });

  it('reports a lock as enums, never as keys or dates', () => {
    // A date here would let a scenario assert a locktime, which means writing
    // one into a fixture, which means the harness starts carrying payment
    // material it has no business holding.
    const lockKey = `02${'11'.repeat(32)}`;
    const probe = createTransactionProbe(entry, null, {
      kind: 'p2pk',
      phase: 'timed-active',
      unlockAt: 1_800_003_600_000,
      main: { pubkeys: [lockKey], requiredSignatures: 1, ourKeys: 0 },
      refund: { pubkeys: [lockKey], requiredSignatures: 1, ourKeys: 1 },
      sigFlag: null,
      mixed: false,
      proofCount: 1,
      lockedProofCount: 1,
      reclaim: { kind: 'at', at: 1_800_003_600_000, via: 'refund' },
      limits: [],
      unknownTags: [],
    });
    expect(probe).toMatchObject({ lock: 'timed-active', reclaim: 'at' });
    expect(JSON.stringify(probe)).not.toContain(lockKey);
    expect(JSON.stringify(probe)).not.toContain('1800003600000');
  });

  it('normalizes presentation labels back to canonical source values', () => {
    expect(createTransactionProbe(entry, 'Clipboard').source).toBe('paste');
    expect(createTransactionProbe(entry, 'QR Code').source).toBe('qr');
    expect(createTransactionProbe(entry, 'Deep Link').source).toBe('deeplink');
  });
});
