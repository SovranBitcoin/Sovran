/**
 * @jest-environment node
 */

import { sendApdu } from '@/shared/lib/nfc/apdu';
import { MAX_CHUNK_SIZE, updateBinary } from '@/shared/lib/nfc/constants';
import { buildTextNdef } from '@/shared/lib/nfc/ndef';
import { writeNdefTextRecord } from '@/shared/lib/nfc/write';

jest.mock('@/shared/lib/nfc/apdu', () => ({
  sendApdu: jest.fn(),
  getStatusMessage: (sw: string) => sw,
}));

jest.mock('@/shared/lib/logger', () => ({
  nfcLog: { debug: jest.fn() },
}));

const mockSendApdu = sendApdu as jest.MockedFunction<typeof sendApdu>;
const ok = { ok: true, raw: [0x90, 0], payload: [], sw: '9000' };
const failed = { ok: false, raw: [0x6a, 0x82], payload: [], sw: '6A82' };

describe('writeNdefTextRecord', () => {
  beforeEach(() => {
    mockSendApdu.mockReset();
    mockSendApdu.mockResolvedValue(ok);
  });

  it('writes zero NLEN, contiguous body chunks, and the real NLEN strictly last', async () => {
    const text = `cashuB${'x'.repeat(700)}`;
    const ndef = buildTextNdef(text);

    await writeNdefTextRecord(text);

    const commands = mockSendApdu.mock.calls.map(([command]) => command);
    expect(commands[0]).toEqual(updateBinary(0, [0, 0]));
    expect(commands.at(-1)).toEqual(updateBinary(0, ndef.slice(0, 2)));

    const chunks = commands.slice(1, -1);
    expect(chunks).toHaveLength(Math.ceil((ndef.length - 2) / MAX_CHUNK_SIZE));
    expect(chunks.flatMap((command) => command.slice(5))).toEqual(ndef.slice(2));

    let expectedOffset = 2;
    for (const command of chunks) {
      const offset = (command[2] << 8) | command[3];
      const data = command.slice(5);
      expect(offset).toBe(expectedOffset);
      expect(command[4]).toBe(data.length);
      expect(data.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
      expectedOffset += data.length;
    }
  });

  it('stops immediately when zeroing NLEN fails', async () => {
    mockSendApdu.mockResolvedValueOnce(failed);

    await expect(writeNdefTextRecord('token')).rejects.toMatchObject({
      code: 'WRITE_NLEN_FAILED',
      statusWord: '6A82',
    });
    expect(mockSendApdu).toHaveBeenCalledTimes(1);
  });

  it('stops before the final NLEN when a body chunk fails', async () => {
    mockSendApdu.mockResolvedValueOnce(ok).mockResolvedValueOnce(failed);

    await expect(writeNdefTextRecord('token')).rejects.toMatchObject({
      code: 'WRITE_CHUNK_FAILED',
      statusWord: '6A82',
    });
    expect(mockSendApdu).toHaveBeenCalledTimes(2);
  });

  it('reports a failed final NLEN after the body was written', async () => {
    mockSendApdu.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(failed);

    await expect(writeNdefTextRecord('token')).rejects.toMatchObject({
      code: 'WRITE_NLEN_FAILED',
      statusWord: '6A82',
    });
    expect(mockSendApdu).toHaveBeenCalledTimes(3);
  });

  it('caps each body chunk at the tag-advertised MLc, never above MAX_CHUNK_SIZE', async () => {
    const text = `cashuB${'x'.repeat(300)}`;
    await writeNdefTextRecord(text, { chunkSize: 52 });
    const chunks = mockSendApdu.mock.calls.map(([command]) => command).slice(1, -1);
    expect(chunks.length).toBeGreaterThan(3);
    for (const command of chunks) expect(command.slice(5).length).toBeLessThanOrEqual(52);

    mockSendApdu.mockClear();
    await writeNdefTextRecord(text, { chunkSize: 10_000 });
    const wide = mockSendApdu.mock.calls.map(([command]) => command).slice(1, -1);
    for (const command of wide) expect(command.slice(5).length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
  });
});
