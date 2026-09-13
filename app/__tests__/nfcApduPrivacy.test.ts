import NfcManager from 'react-native-nfc-manager';
import { sendApdu } from '@/shared/lib/nfc/apdu';
import { nfcLog } from '@/shared/lib/logger';

jest.mock('react-native-nfc-manager', () => ({ isoDepHandler: { transceive: jest.fn() } }));
jest.mock('@/shared/lib/logger', () => ({
  nfcLog: { debug: jest.fn(), error: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

it('logs only APDU lengths and status while preserving the complete transport payload', async () => {
  const bytes = [0x63, 0x61, 0x73, 0x68, 0x75, 0x41, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74];
  jest.mocked(NfcManager.isoDepHandler.transceive).mockResolvedValue([...bytes, 0x90, 0]);
  const response = await sendApdu(bytes, 'WRITE');
  expect(NfcManager.isoDepHandler.transceive).toHaveBeenCalledWith(bytes);
  expect(response.payload).toEqual(bytes);
  expect(nfcLog.debug).toHaveBeenNthCalledWith(1, 'nfc.apdu.send', {
    label: 'WRITE',
    bytes: bytes.length,
  });
  expect(nfcLog.debug).toHaveBeenNthCalledWith(2, 'nfc.apdu.response', {
    bytes: bytes.length + 2,
    sw: '9000',
    status: 'Success',
  });
});
it('does not forward an arbitrary native error containing APDU bytes into logs or user errors', async () => {
  jest
    .mocked(NfcManager.isoDepHandler.transceive)
    .mockRejectedValue(new Error('native failed with private payload 636173687541736563726574'));
  await expect(sendApdu([0], 'WRITE')).rejects.toMatchObject({
    code: 'TRANSCEIVE_FAILED',
    message: 'NFC communication failed. Please try again.',
  });
  expect(nfcLog.error).toHaveBeenCalledWith('nfc.apdu.transceive_failed', {
    code: 'TRANSCEIVE_FAILED',
  });
});
