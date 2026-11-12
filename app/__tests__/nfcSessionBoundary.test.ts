/**
 * @jest-environment node
 *
 * Characterization of the NFC public surface — the payment adapter
 * (`createNfcAdapter`) and the standalone token writer (`writeTokenToNFC`) —
 * over a whole native session: refusals before a session, starting the native
 * manager once, cancelling a stale session, the request timeout, releasing
 * the session after success and failure, and the tag checks made before any
 * write. The real session, adapter, writer, APDU and NDEF code run; only
 * `react-native-nfc-manager` is replaced, by a fake that simulates a Type 4
 * tag (capability container + NDEF file) answering APDUs.
 */

import NfcManager from 'react-native-nfc-manager';

import { createPaymentMachine } from 'wallet';

import { createNfcAdapter, writeTokenToNFC } from '@/shared/lib/nfc';
import { holdNfcReader } from '@/shared/lib/nfc/reader';
import { buildTextNdef, decodeNdefText } from '@/shared/lib/nfc/ndef';

type Tag = {
  cc: number[] | null;
  ndef: number[];
  /** APDUs in order, as hex labels: SELECT AID/CC/NDEF, READ, UPDATE. */
  log: string[];
  failUpdateAt?: number;
};

const mockTag: { current: Tag } = { current: { cc: null, ndef: [], log: [] } };
const mockNative = {
  supported: true,
  enabled: true,
  request: null as null | (() => Promise<unknown>),
};

jest.mock('react-native-nfc-manager', () => {
  class UserCancel extends Error {}
  let selected: 'none' | 'cc' | 'ndef' = 'none';
  const ok = (payload: number[] = []) => [...payload, 0x90, 0x00];
  const manager = {
    start: jest.fn(async () => undefined),
    isSupported: jest.fn(async () => mockNative.supported),
    isEnabled: jest.fn(async () => mockNative.enabled),
    cancelTechnologyRequest: jest.fn(async () => undefined),
    requestTechnology: jest.fn(async () => (mockNative.request ? mockNative.request() : 'IsoDep')),
    isoDepHandler: {
      transceive: jest.fn(async (apdu: number[]) => {
        const tag = mockTag.current;
        const [, ins, p1, p2, lc] = apdu;
        if (ins === 0xa4) {
          if (p1 === 0x04) {
            tag.log.push('SELECT AID');
            selected = 'none';
            return ok();
          }
          const file = (apdu[5] << 8) | apdu[6];
          if (file === 0xe103) {
            tag.log.push('SELECT CC');
            if (!tag.cc) return [0x6a, 0x82];
            selected = 'cc';
            return ok();
          }
          tag.log.push('SELECT NDEF');
          selected = 'ndef';
          return ok();
        }
        const offset = (p1 << 8) | p2;
        if (ins === 0xb0) {
          tag.log.push(`READ ${selected} @${offset}+${lc}`);
          const file = selected === 'cc' ? tag.cc! : tag.ndef;
          return ok(file.slice(offset, offset + lc));
        }
        if (ins === 0xd6) {
          const index = tag.log.filter((l) => l.startsWith('UPDATE')).length;
          tag.log.push(`UPDATE @${offset}+${lc}`);
          if (tag.failUpdateAt === index) throw new Error('Tag was lost');
          const data = apdu.slice(5, 5 + lc);
          for (let i = 0; i < data.length; i += 1) tag.ndef[offset + i] = data[i];
          return ok();
        }
        return [0x6d, 0x00];
      }),
    },
  };
  return {
    __esModule: true,
    default: manager,
    NfcTech: { IsoDep: 'IsoDep' },
    NfcAdapter: { FLAG_READER_NFC_A: 1, FLAG_READER_NFC_B: 2 },
    NfcError: { UserCancel },
  };
});

const native = jest.mocked(NfcManager);

/** A capability container: MLe/MLc, max NDEF file size, write access byte. */
function cc({ mlc = 0x00f6, maxNdef = 0x0800, writeAccess = 0x00 } = {}) {
  return [
    0x00,
    0x0f,
    0x20,
    0x00,
    0xff,
    mlc >> 8,
    mlc & 0xff,
    0x04,
    0x06,
    0xe1,
    0x04,
    maxNdef >> 8,
    maxNdef & 0xff,
    0x00,
    writeAccess,
  ];
}

function terminalWith(text: string): Tag {
  return { cc: cc(), ndef: buildTextNdef(text), log: [] };
}

/** The text a reader finds on the tag: the NDEF message NLEN points at. */
function textOnTag(file: number[]): string {
  const nlen = (file[0] << 8) | file[1];
  return decodeNdefText(file.slice(2, 2 + nlen));
}

const TOKEN = `cashuB${'t'.repeat(300)}`;
const CREQ = 'creqAdummy-payment-request';

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.supported = true;
  mockNative.enabled = true;
  mockNative.request = null;
  mockTag.current = { cc: cc(), ndef: [0, 0], log: [] };
});

describe('refusals before a session', () => {
  it('refuses on a device without NFC and never asks for a tag', async () => {
    mockNative.supported = false;
    await expect(writeTokenToNFC(TOKEN)).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(createNfcAdapter().readPaymentRequest()).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
    expect(native.requestTechnology).not.toHaveBeenCalled();
  });

  it('refuses when NFC is turned off and never asks for a tag', async () => {
    mockNative.enabled = false;
    await expect(writeTokenToNFC(TOKEN)).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    expect(native.requestTechnology).not.toHaveBeenCalled();
  });

  it('isAvailable reports support and the enabled switch', async () => {
    const adapter = createNfcAdapter();
    expect(await adapter.isAvailable()).toBe(true);
    mockNative.enabled = false;
    expect(await adapter.isAvailable()).toBe(false);
    mockNative.supported = false;
    expect(await adapter.isAvailable()).toBe(false);
  });
});

describe('the session', () => {
  it('starts the native manager once across sessions and cancels any stale session first', async () => {
    mockTag.current = terminalWith(CREQ);
    const adapter = createNfcAdapter();
    await adapter.readPaymentRequest();
    await adapter.releaseSession();
    const startsAfterFirst = native.start.mock.calls.length;
    mockTag.current = terminalWith(CREQ);
    await adapter.readPaymentRequest();

    expect(native.start.mock.calls.length).toBe(startsAfterFirst);
    expect(native.cancelTechnologyRequest.mock.invocationCallOrder[0]).toBeLessThan(
      native.requestTechnology.mock.invocationCallOrder[0]
    );
  });

  it('tells whoever holds the reader once a tag is in the field', async () => {
    const connected = jest.fn();
    const releaseReader = holdNfcReader('explicit', connected);
    mockTag.current = terminalWith(CREQ);
    await createNfcAdapter().readPaymentRequest();
    releaseReader();
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('gives up after 30 seconds with no tag and cancels the request', async () => {
    jest.useFakeTimers();
    mockNative.request = () => new Promise(() => undefined);
    const attempt = writeTokenToNFC(TOKEN);
    const outcome = expect(attempt).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(29_999);
    const cancelsBefore = native.cancelTechnologyRequest.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
    expect(native.cancelTechnologyRequest.mock.calls.length).toBeGreaterThan(cancelsBefore);
    jest.useRealTimers();
  });

  it('passes a user cancel through unwrapped', async () => {
    mockNative.request = async () => {
      throw new Error('cancelled');
    };
    await expect(writeTokenToNFC(TOKEN)).rejects.toThrow('cancelled');
    await expect(writeTokenToNFC(TOKEN)).rejects.not.toHaveProperty('code', 'WRITE_FAILED');
  });
});

describe('reading a payment request', () => {
  it('reads the request and keeps the session open for the write that follows', async () => {
    mockTag.current = terminalWith(CREQ);
    const adapter = createNfcAdapter();

    expect(await adapter.readPaymentRequest()).toBe(CREQ);
    const cancelsAfterRead = native.cancelTechnologyRequest.mock.calls.length;
    expect(cancelsAfterRead).toBe(1); // only the stale-session prelude

    mockTag.current.log = [];
    await adapter.writeToken(TOKEN);
    expect(textOnTag(mockTag.current.ndef)).toBe(TOKEN);
    expect(native.cancelTechnologyRequest.mock.calls.length).toBe(cancelsAfterRead);

    await adapter.releaseSession();
    expect(native.cancelTechnologyRequest.mock.calls.length).toBe(cancelsAfterRead + 1);
  });

  it('releases the session when the read fails', async () => {
    mockTag.current = { cc: cc(), ndef: [0, 0], log: [] };
    await expect(createNfcAdapter().readPaymentRequest()).rejects.toMatchObject({
      code: 'EMPTY_NDEF',
    });
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(2);
  });

  // The session is the payment machine's from the read on: it lets go of it
  // with the tap, and only while no newer read has taken it over.
  it('leaves the session to the payment machine when the payment write fails', async () => {
    mockTag.current = terminalWith(CREQ);
    const adapter = createNfcAdapter();
    await adapter.readPaymentRequest();
    mockTag.current.failUpdateAt = 1;

    await expect(adapter.writeToken(TOKEN)).rejects.toMatchObject({ code: 'TAG_LOST' });
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });
});

describe('a payment machine tap over the adapter', () => {
  /** A real NUT-18 request: 100 sat, paid to mint1.example.com. */
  const REQUEST =
    'creqApGF0gaNhdGRwb3N0YWF4GWh0dHBzOi8vbWludDEuZXhhbXBsZS5jb21hZ/dhYRhkYXVjc2F0YW2BeBlodHRwczovL21pbnQxLmV4YW1wbGUuY29t';
  const MINT = 'https://mint1.example.com';

  function tapMachine(
    executeNfcSend: () => Promise<{ token: string; historyEntry: string; operationId: string }>
  ) {
    const adapter = createNfcAdapter();
    const machine = createPaymentMachine({
      handlers: {},
      getContext: () => ({
        trustedMintUrls: [MINT],
        mintBalances: { [MINT]: 1000 },
        proofAmounts: {},
      }),
      getUnit: () => 'sat',
      nfcAdapter: adapter,
      operations: {
        executeSend: jest.fn(),
        executeMintQuote: jest.fn(),
        buildMintListItems: jest.fn(async () => []),
        executeNfcSend,
        rollbackSend: jest.fn(async () => ({ kind: 'reclaimed' as const })),
      },
      scanSources: { nfc: async () => ({ data: await adapter.readPaymentRequest() }) },
    });
    return { machine };
  }

  it('does not cancel a newer read when an older tap fails to write', async () => {
    mockTag.current = terminalWith(REQUEST);
    let created!: () => void;
    const { machine } = tapMachine(async () => {
      await new Promise<void>((resolve) => {
        created = resolve;
      });
      return { token: TOKEN, historyEntry: '{}', operationId: 'op-a' };
    });
    const tapA = machine.scan!(undefined, { source: 'nfc' });
    await waitFor(() => created !== undefined);

    // A second tap starts reading and holds its own session open.
    mockNative.request = () => new Promise(() => {});
    void machine.scan!(undefined, { source: 'nfc' });
    await waitFor(() => native.requestTechnology.mock.calls.length === 2);
    const cancelsBeforeWrite = native.cancelTechnologyRequest.mock.calls.length;

    mockTag.current.failUpdateAt = 0;
    created();
    await tapA;

    expect(mockTag.current.log.some((line) => line.startsWith('UPDATE'))).toBe(true);
    expect(native.cancelTechnologyRequest.mock.calls.length).toBe(cancelsBeforeWrite);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error('condition never held');
}

describe('writing a token to a tag', () => {
  it('checks the tag, then zeroes NLEN, writes the body and sets NLEN last, and releases', async () => {
    await writeTokenToNFC(TOKEN);
    const { log } = mockTag.current;

    expect(log.slice(0, 4)).toEqual(['SELECT AID', 'SELECT CC', 'READ cc @0+15', 'SELECT NDEF']);
    const updates = log.filter((l) => l.startsWith('UPDATE'));
    expect(updates[0]).toBe('UPDATE @0+2');
    expect(updates.at(-1)).toBe('UPDATE @0+2');
    expect(updates.slice(1, -1).every((l) => !l.startsWith('UPDATE @0+'))).toBe(true);
    expect(textOnTag(mockTag.current.ndef)).toBe(TOKEN);
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(2);
  });

  it('writes in chunks no larger than the tag’s MLc', async () => {
    mockTag.current.cc = cc({ mlc: 50 });
    await writeTokenToNFC(TOKEN);

    const bodyChunks = mockTag.current.log
      .filter((l) => l.startsWith('UPDATE'))
      .slice(1, -1)
      .map((l) => Number(l.split('+')[1]));
    expect(Math.max(...bodyChunks)).toBe(50);
    expect(textOnTag(mockTag.current.ndef)).toBe(TOKEN);
  });

  it('refuses a read-only tag before writing anything, and releases', async () => {
    mockTag.current.cc = cc({ writeAccess: 0xff });
    mockTag.current.ndef = buildTextNdef('previous content');

    await expect(writeTokenToNFC(TOKEN)).rejects.toMatchObject({ code: 'TAG_READ_ONLY' });
    expect(mockTag.current.log.some((l) => l.startsWith('UPDATE'))).toBe(false);
    expect(textOnTag(mockTag.current.ndef)).toBe('previous content');
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(2);
  });

  it('refuses a token larger than the tag before writing anything', async () => {
    mockTag.current.cc = cc({ maxNdef: 64 });
    await expect(writeTokenToNFC(TOKEN)).rejects.toMatchObject({ code: 'TAG_TOO_SMALL' });
    expect(mockTag.current.log.some((l) => l.startsWith('UPDATE'))).toBe(false);
  });

  it('writes without checks to a tag with no capability container', async () => {
    mockTag.current.cc = null;
    await writeTokenToNFC(TOKEN);
    expect(textOnTag(mockTag.current.ndef)).toBe(TOKEN);
  });

  it('a tag lost mid-write fails with NLEN still zero, and releases', async () => {
    mockTag.current.ndef = buildTextNdef('previous content');
    mockTag.current.failUpdateAt = 2;

    await expect(writeTokenToNFC(TOKEN)).rejects.toMatchObject({ code: 'TAG_LOST' });
    expect(mockTag.current.ndef.slice(0, 2)).toEqual([0, 0]);
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(2);
  });
});
