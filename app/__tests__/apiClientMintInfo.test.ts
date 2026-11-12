/**
 * @jest-environment node
 *
 * Characterization of `fetchMintInfo`, the one API helper that dials a host the
 * person typed or scanned: the https-only guard, the URL it requests, the
 * NUT-06 spine check, and how HTTP and abort failures come back. Only the
 * global `fetch` is replaced.
 */

import { ApiHttpError, ApiParseError, fetchMintInfo } from '@/shared/lib/apiClient';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const mockFetch = jest.fn();

const INFO = { name: 'Test Mint', pubkey: `02${'ab'.repeat(32)}`, version: 'nutshell/0.16.0' };

function respond(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  });
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockFetch.mockReset();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: mockFetch as unknown as typeof fetch,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else Reflect.deleteProperty(globalThis, 'fetch');
});

describe('fetchMintInfo', () => {
  it.each(['http://mint.example', 'file:///etc/passwd', 'ftp://mint.example'])(
    'refuses %s without calling fetch',
    async (url) => {
      const result = await fetchMintInfo(url);

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.message).toMatch(/^Mint URL must use https:/);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('refuses an unparseable URL without calling fetch', async () => {
    const result = await fetchMintInfo('not a url');

    expect(result.isErr() && result.error.message).toBe('Invalid mint URL');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['https://mint.example', 'https://mint.example/v1/info'],
    ['https://mint.example/', 'https://mint.example/v1/info'],
    ['https://mint.example/cashu', 'https://mint.example/cashu/v1/info'],
  ])('requests %s as %s', async (input, requested) => {
    respond(INFO);

    await fetchMintInfo(input);

    expect(mockFetch).toHaveBeenCalledWith(
      requested,
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('returns the body with unknown fields kept', async () => {
    const body = { ...INFO, nuts: { '4': { disabled: false } }, motd: 'hello', icon_url: 'x' };
    respond(body);

    const result = await fetchMintInfo('https://mint.example');

    expect(result.isOk() && result.value).toEqual(body);
  });

  it.each([
    ['a non-string name', { ...INFO, name: [1, 2, 3] }, 'name'],
    ['no pubkey', { name: INFO.name, version: INFO.version }, 'pubkey'],
    ['no version', { name: INFO.name, pubkey: INFO.pubkey }, 'version'],
  ])('refuses a body with %s as a parse error naming the path only', async (_label, body, path) => {
    respond(body);

    const result = await fetchMintInfo('https://mint.example');

    expect(result.isErr()).toBe(true);
    const error = result.isErr() ? result.error : null;
    expect(error).toBeInstanceOf(ApiParseError);
    const parseError = error as ApiParseError;
    expect(parseError.where).toBe('cashu/mint/info');
    expect(parseError.issues).toEqual([{ code: 'invalid_type', path }]);
    expect(JSON.stringify(parseError.issues)).not.toContain(INFO.pubkey);
  });

  it('returns an HTTP error carrying the status for a 503', async () => {
    respond({}, { ok: false, status: 503, statusText: 'Service Unavailable' });

    const result = await fetchMintInfo('https://mint.example');

    const error = result.isErr() ? result.error : null;
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(503);
  });

  it('returns the abort error when the caller cancels', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
          );
        })
    );

    const pending = fetchMintInfo('https://mint.example', { signal: controller.signal });
    controller.abort();
    const result = await pending;

    expect(result.isErr() && result.error.name).toBe('AbortError');
  });
});
