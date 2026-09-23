/**
 * @jest-environment node
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

import {
  createDirectMessageSender,
  NoDirectMessageRelaysError,
  type DirectMessageRelayPool,
} from '@/shared/lib/nostr/sendDirectMessage';

function fakePool(publish: DirectMessageRelayPool['publish'], dmRelays: string[] = []) {
  const close = jest.fn();
  const pool = { publish: jest.fn(publish), close } as unknown as DirectMessageRelayPool;
  const resolveDmRelays = jest.fn(async () => dmRelays);
  const send = createDirectMessageSender({ openPool: () => pool, resolveDmRelays });
  return { send, publishMock: pool.publish as jest.Mock, close, resolveDmRelays };
}

const recipient = getPublicKey(generateSecretKey());

describe('sendDirectMessageToRelays', () => {
  it('publishes one gift wrap to the nprofile relays through the injected pool', async () => {
    const relays = ['wss://a.example', 'wss://b.example'];
    const { send, publishMock, close } = fakePool((urls) => urls.map(() => Promise.resolve('ok')));

    await send({
      senderPrivateKey: generateSecretKey(),
      nprofile: nip19.nprofileEncode({ pubkey: recipient, relays }),
      message: 'hello',
    });

    expect(publishMock).toHaveBeenCalledTimes(1);
    const [urls, event] = publishMock.mock.calls[0];
    expect(urls).toEqual(relays);
    expect(event.kind).toBe(1059);
    expect(close).toHaveBeenCalledWith(relays);
  });

  it('rejects when every relay rejects', async () => {
    const { send } = fakePool((urls) => urls.map(() => Promise.reject(new Error('blocked'))));
    await expect(
      send({
        senderPrivateKey: generateSecretKey(),
        nprofile: nip19.nprofileEncode({ pubkey: recipient, relays: ['wss://a.example'] }),
        message: 'hello',
      })
    ).rejects.toBeInstanceOf(AggregateError);
  });

  it('does not look up kind:10050 when the nprofile carries hints', async () => {
    const { send, resolveDmRelays } = fakePool((urls) => urls.map(() => Promise.resolve('ok')));

    await send({
      senderPrivateKey: generateSecretKey(),
      nprofile: nip19.nprofileEncode({ pubkey: recipient, relays: ['wss://a.example'] }),
      message: 'hello',
    });

    expect(resolveDmRelays).not.toHaveBeenCalled();
  });

  it("falls back to the recipient's kind:10050 relays when the nprofile has no hints", async () => {
    const dmRelays = ['wss://inbox.example'];
    const { send, publishMock, resolveDmRelays } = fakePool(
      (urls) => urls.map(() => Promise.resolve('ok')),
      dmRelays
    );

    await send({
      senderPrivateKey: generateSecretKey(),
      nprofile: nip19.nprofileEncode({ pubkey: recipient, relays: [] }),
      message: 'hello',
    });

    expect(resolveDmRelays).toHaveBeenCalledWith(recipient);
    expect(publishMock.mock.calls[0][0]).toEqual(dmRelays);
  });

  it('refuses to publish when neither the nprofile nor a kind:10050 declares a relay', async () => {
    const { send, publishMock } = fakePool(
      (urls) => urls.map(() => Promise.resolve('ok')),
      [] // no kind:10050 published
    );

    await expect(
      send({
        senderPrivateKey: generateSecretKey(),
        nprofile: nip19.nprofileEncode({ pubkey: recipient, relays: [] }),
        message: 'hello',
      })
    ).rejects.toBeInstanceOf(NoDirectMessageRelaysError);
    // The proofs must not reach a guessed relay set.
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('rejects a non-nprofile input before publishing', async () => {
    const { send, publishMock } = fakePool(() => []);
    await expect(
      send({
        senderPrivateKey: generateSecretKey(),
        nprofile: nip19.npubEncode(recipient),
        message: 'hello',
      })
    ).rejects.toThrow('Invalid nprofile format');
    expect(publishMock).not.toHaveBeenCalled();
  });
});
