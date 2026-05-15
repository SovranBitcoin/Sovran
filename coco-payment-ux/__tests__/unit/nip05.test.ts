import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchNip05Pubkey } from '../../src/nip05';
import { resolveRecipientPubkey } from '../../src/recipient';

const PUBKEY = 'a'.repeat(64);
const ODELL_PUBKEY = '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9';

function mockJsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  const response: Pick<Response, 'ok' | 'status' | 'json'> = {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  };
  return response as Response;
}

describe('NIP-05 recipient resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the lightning-address well-known URL and returns lowercase pubkey', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      mockJsonResponse({
        names: {
          alice: PUBKEY.toUpperCase(),
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNip05Pubkey('alice@example.com')).resolves.toBe(PUBKEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://example.com/.well-known/nostr.json?name=alice'
    );
  });

  it('matches providers that lowercase a mixed-case local part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJsonResponse({
          names: {
            alice: PUBKEY,
          },
        })
      )
    );

    await expect(fetchNip05Pubkey('Alice@example.com')).resolves.toBe(PUBKEY);
  });

  it('accepts the real Primal response shape for odell@primal.net', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      mockJsonResponse({
        names: {
          odell: ODELL_PUBKEY,
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNip05Pubkey('odell@primal.net')).resolves.toBe(ODELL_PUBKEY);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://primal.net/.well-known/nostr.json?name=odell'
    );
  });

  it('returns null for onion hosts without starting a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNip05Pubkey('alice@example.onion')).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for invalid responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJsonResponse({
          names: {
            alice: 'not-a-pubkey',
          },
        })
      )
    );

    await expect(fetchNip05Pubkey('alice@example.com')).resolves.toBeNull();
  });

  it('only resolves lightning-address targets', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveRecipientPubkey('lnbc1mockinvoice')).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
