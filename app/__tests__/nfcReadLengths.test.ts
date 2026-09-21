import { createNfcAdapter } from '@/shared/lib/nfc/adapter';
import { sendApdu } from '@/shared/lib/nfc/apdu';
import { buildTextNdef } from '@/shared/lib/nfc/ndef';
import { releaseSession } from '@/shared/lib/nfc/session';

jest.mock('@/shared/lib/nfc/apdu', () => ({
  sendApdu: jest.fn(),
  selectNdefApp: jest.fn(),
  getStatusMessage: () => 'Success',
}));
jest.mock('@/shared/lib/nfc/session', () => ({
  acquireSession: jest.fn(),
  releaseSession: jest.fn(),
}));
jest.mock('@/shared/lib/nfc/status', () => ({
  isNfcSupported: jest.fn(),
  isNfcEnabled: jest.fn(),
}));
jest.mock('@/shared/lib/nfc/write', () => ({ writeNdefTextRecord: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  nfcLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const response = (payload: number[]) => ({
  ok: true,
  raw: [...payload, 0x90, 0],
  payload,
  sw: '9000',
});
beforeEach(() => jest.clearAllMocks());

it.each([[], [1], [0, 1, 2]])(
  'rejects malformed NLEN %j before reading content',
  async (...args) => {
    // Jest expands an array row into arguments.
    const payload = args as number[];
    jest.mocked(sendApdu).mockResolvedValueOnce(response(payload));
    await expect(createNfcAdapter().readPaymentRequest()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(sendApdu).toHaveBeenCalledTimes(1);
    expect(releaseSession).toHaveBeenCalledTimes(1);
  }
);
it.each([2, 4])('rejects short or oversized body of %i bytes', async (length) => {
  jest
    .mocked(sendApdu)
    .mockResolvedValueOnce(response([0, 3]))
    .mockResolvedValueOnce(response(Array(length).fill(0)));
  await expect(createNfcAdapter().readPaymentRequest()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  expect(releaseSession).toHaveBeenCalledTimes(1);
});
it('stops immediately on a truncated chunk, without decoding or advancing the offset', async () => {
  jest
    .mocked(sendApdu)
    .mockResolvedValueOnce(response([1, 0]))
    .mockResolvedValueOnce(response(Array(239).fill(0)));
  await expect(createNfcAdapter().readPaymentRequest()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  expect(sendApdu).toHaveBeenCalledTimes(2);
  expect(releaseSession).toHaveBeenCalledTimes(1);
});
it('concatenates exact chunks and keeps the session for the token reply', async () => {
  // A 249-character request makes a 256-byte record: one full 240-byte chunk plus 16.
  const request = `creqA${'x'.repeat(244)}`;
  const ndef = buildTextNdef(request);
  jest
    .mocked(sendApdu)
    .mockResolvedValueOnce(response(ndef.slice(0, 2)))
    .mockResolvedValueOnce(response(ndef.slice(2, 242)))
    .mockResolvedValueOnce(response(ndef.slice(242)));
  expect(ndef.slice(0, 2)).toEqual([1, 0]);
  expect(await createNfcAdapter().readPaymentRequest()).toBe(request);
  expect(sendApdu).toHaveBeenCalledTimes(3);
  expect(releaseSession).not.toHaveBeenCalled();
});
