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
    });

    const serialized = serializeTransactionProbe(entry, 'Paste');
    expect(JSON.parse(serialized)).toEqual({
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
    });
    expect(serialized).not.toContain('cashuB');
    expect(serialized).not.toContain('lnbc');
    expect(serialized).not.toContain('secret-id');
    expect(serialized).not.toContain('/private/path');
  });

  it('normalizes presentation labels back to canonical source values', () => {
    expect(createTransactionProbe(entry, 'Clipboard').source).toBe('paste');
    expect(createTransactionProbe(entry, 'QR Code').source).toBe('qr');
    expect(createTransactionProbe(entry, 'Deep Link').source).toBe('deeplink');
  });
});
