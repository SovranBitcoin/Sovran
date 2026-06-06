/* eslint-disable import/first */

jest.mock('bitchat-module', () => ({
  startBLE: jest.fn(),
  startBLEPrivateChat: jest.fn(),
  sendBLEPrivateMessage: jest.fn(),
  sendBLEMessage: jest.fn(),
}));

jest.mock('@/shared/lib/id', () => ({
  mintLocalId: jest.fn((prefix: string) => `${prefix}-id`),
}));

import {
  chunkUtf8,
  sendBLEPrivateMessageChunks,
  sendBLEPublicMessage,
} from '@/features/bitchat/lib/blePrivateDelivery';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const IDENTITY_MATERIAL: BitchatBLEIdentityMaterial = {
  version: 'sovran-bitchat-ble-v1',
  nostrPubkey: '11'.repeat(32),
  noisePrivateKeyHex: '22'.repeat(32),
  signingPrivateKeyHex: '33'.repeat(32),
};

describe('BitChat BLE private delivery', () => {
  it('chunks UTF-8 payloads at the byte limit', () => {
    const payload = 'a'.repeat(612);
    const chunks = chunkUtf8(payload, 255);

    expect(chunks.join('')).toBe(payload);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => byteLength(chunk) <= 255)).toBe(true);
  });

  it('does not split multibyte characters', () => {
    const payload = 'near-pay-🙂'.repeat(40);
    const chunks = chunkUtf8(payload, 32);

    expect(chunks.join('')).toBe(payload);
    expect(chunks.every((chunk) => byteLength(chunk) <= 32)).toBe(true);
  });

  it('sends chunks serially in order', async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    const firstSend = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const sendBLEPrivateMessage = jest
      .fn<Promise<string>, [string, string, string, string]>()
      .mockImplementationOnce(() => firstSend)
      .mockResolvedValueOnce('message-2');
    const startBLE = jest
      .fn<Promise<void>, [string, string, BitchatBLEIdentityMaterial]>()
      .mockResolvedValue(undefined);
    const startBLEPrivateChat = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const sleep = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    let nextId = 0;

    const delivery = sendBLEPrivateMessageChunks({
      peerID: 'peer-a',
      content: 'abcdef',
      nickname: 'sender',
      profileScope: 'profile-a',
      identityMaterial: IDENTITY_MATERIAL,
      maxBytes: 3,
      deps: {
        startBLE,
        startBLEPrivateChat,
        sendBLEPrivateMessage,
        sleep,
        createMessageId: () => `message-${++nextId}`,
        now: () => 0,
      },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sendBLEPrivateMessage).toHaveBeenCalledTimes(1);
    expect(sendBLEPrivateMessage).toHaveBeenNthCalledWith(
      1,
      'peer-a',
      'abc',
      'sender',
      'message-1'
    );

    resolveFirst?.('message-1');
    await delivery;

    expect(sendBLEPrivateMessage).toHaveBeenCalledTimes(2);
    expect(sendBLEPrivateMessage).toHaveBeenNthCalledWith(
      2,
      'peer-a',
      'def',
      'sender',
      'message-2'
    );
    expect(startBLE).toHaveBeenCalledWith('sender', 'profile-a', IDENTITY_MATERIAL);
    expect(startBLEPrivateChat).toHaveBeenCalledWith('peer-a');
  });

  it('fails safely before native calls when profile scope is missing', async () => {
    const startBLE = jest
      .fn<Promise<void>, [string, string, BitchatBLEIdentityMaterial]>()
      .mockResolvedValue(undefined);

    await expect(
      sendBLEPrivateMessageChunks({
        peerID: 'peer-a',
        content: 'cashuA...',
        nickname: 'sender',
        profileScope: '',
        identityMaterial: IDENTITY_MATERIAL,
        deps: { startBLE },
      })
    ).rejects.toThrow('BitChat profile scope unavailable');

    expect(startBLE).not.toHaveBeenCalled();
  });

  it('fails safely before native calls when identity material is missing', async () => {
    const startBLE = jest
      .fn<Promise<void>, [string, string, BitchatBLEIdentityMaterial]>()
      .mockResolvedValue(undefined);

    await expect(
      sendBLEPrivateMessageChunks({
        peerID: 'peer-a',
        content: 'cashuA...',
        nickname: 'sender',
        profileScope: 'profile-a',
        identityMaterial: null,
        deps: { startBLE },
      })
    ).rejects.toThrow('BitChat identity material unavailable');

    expect(startBLE).not.toHaveBeenCalled();
  });
});

describe('BitChat BLE public message delivery', () => {
  it('sends the whole token as a single public message after starting BLE', async () => {
    const startBLE = jest
      .fn<Promise<void>, [string, string, BitchatBLEIdentityMaterial]>()
      .mockResolvedValue(undefined);
    const sendBLEMessage = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    // A multi-KB token that would have been split into many private DM chunks.
    const token = `cashuB${'A'.repeat(4000)}`;

    const result = await sendBLEPublicMessage({
      content: token,
      nickname: 'sender',
      profileScope: 'profile-a',
      identityMaterial: IDENTITY_MATERIAL,
      deps: { startBLE, sendBLEMessage, now: () => 0 },
    });

    expect(startBLE).toHaveBeenCalledWith('sender', 'profile-a', IDENTITY_MATERIAL);
    expect(sendBLEMessage).toHaveBeenCalledTimes(1);
    expect(sendBLEMessage).toHaveBeenCalledWith(token);
    expect(result).toEqual({ startupMs: 0, sendMs: 0 });
  });

  it('fails safely before native calls when profile scope is missing', async () => {
    const sendBLEMessage = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

    await expect(
      sendBLEPublicMessage({
        content: 'cashuA...',
        nickname: 'sender',
        profileScope: '',
        identityMaterial: IDENTITY_MATERIAL,
        deps: { sendBLEMessage },
      })
    ).rejects.toThrow('BitChat profile scope unavailable');

    expect(sendBLEMessage).not.toHaveBeenCalled();
  });

  it('fails safely before native calls when identity material is missing', async () => {
    const sendBLEMessage = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

    await expect(
      sendBLEPublicMessage({
        content: 'cashuA...',
        nickname: 'sender',
        profileScope: 'profile-a',
        identityMaterial: null,
        deps: { sendBLEMessage },
      })
    ).rejects.toThrow('BitChat identity material unavailable');

    expect(sendBLEMessage).not.toHaveBeenCalled();
  });
});
