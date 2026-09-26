/**
 * The mint liveness probe: what a `/v1/info` outcome means, how this phone's
 * verdict merges with nagg's, and that a sweep reports cached answers at once
 * and never lets a thrown probe take the list down. A mirror of the provider
 * probe with one deliberate difference — nothing here disables a row.
 */
import { err, ok } from 'neverthrow';

import {
  cachedMintProbe,
  classifyMintInfoOutcome,
  probeMints,
  recordMintReachability,
  resolveMintStatus,
} from '@/shared/lib/cashu/mintHealth';
import { ApiHttpError, ApiParseError, fetchMintInfo } from '@/shared/lib/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';

jest.mock('@/shared/lib/apiClient', () => ({
  ...jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient'),
  fetchMintInfo: jest.fn(),
}));

const notAMint = () =>
  new ApiParseError({ type: 'schema/zod', where: 'cashu/mint/info', issues: [] });
const answered = () =>
  ok<GetInfoResponse, Error>({
    name: 'm',
    pubkey: 'p',
    version: 'v',
    contact: [],
    nuts: { '4': { methods: [], disabled: false }, '5': { methods: [], disabled: false } },
  });

const A = 'https://mint.a.example';
const B = 'https://mint.b.example';
const keyOf = (url: string) => url.replace('https://', '');

beforeEach(() => {
  jest.mocked(fetchMintInfo).mockReset();
});

describe('classifyMintInfoOutcome', () => {
  it('reads a 5xx, a network error or a timeout as not answering', () => {
    expect(classifyMintInfoOutcome(new ApiHttpError(503, 'down'), false)).toBe('offline');
    expect(classifyMintInfoOutcome(new Error('network request failed'), false)).toBe('offline');
  });
  it('reads a 4xx or a non-NUT-06 body as answering, just not as a mint — unknown', () => {
    expect(classifyMintInfoOutcome(new ApiHttpError(404, 'nope'), false)).toBe('unknown');
    expect(classifyMintInfoOutcome(notAMint(), false)).toBe('unknown');
  });
  it('a caller abort is not evidence', () => {
    expect(classifyMintInfoOutcome(new Error('aborted'), true)).toBe('unknown');
  });
  it('an answer is online', () => {
    expect(classifyMintInfoOutcome(null, false)).toBe('online');
  });
});

describe('resolveMintStatus', () => {
  it('first-hand evidence beats nagg; unknown never overrides', () => {
    expect(resolveMintStatus('offline', 'online')).toBe('offline');
    expect(resolveMintStatus('unknown', 'online')).toBe('online');
    expect(resolveMintStatus(undefined, 'offline')).toBe('offline');
    expect(resolveMintStatus('unknown', undefined)).toBe('unknown');
  });
});

describe('probeMints', () => {
  it('reports a fresh cached answer at once and probes the rest, caching verdicts', async () => {
    recordMintReachability(A, true);
    jest.mocked(fetchMintInfo).mockResolvedValue(err(new ApiHttpError(502, 'bad gateway')));
    const seen: Record<string, string> = {};
    await probeMints([A, `${B}/`], { onResult: (probe) => (seen[probe.key] = probe.status) });
    // Keyed the way rows look presence up: the normalized mint key.
    expect(seen).toEqual({ [keyOf(A)]: 'online', [keyOf(B)]: 'offline' });
    expect(jest.mocked(fetchMintInfo)).toHaveBeenCalledTimes(1);
    expect(cachedMintProbe(B)?.status).toBe('offline');
  });

  it('an unknown verdict is reported but not cached, and a throw does not end the sweep', async () => {
    const C = 'https://mint.c.example';
    const D = 'https://mint.d.example';
    jest
      .mocked(fetchMintInfo)
      .mockImplementation(async (url: string) =>
        url.startsWith(C) ? err(notAMint()) : Promise.reject(new Error('boom'))
      );
    const seen: string[] = [];
    await probeMints([C, D], {
      onResult: (probe) => seen.push(`${probe.key}:${probe.status}`),
    });
    expect(seen).toEqual([`${keyOf(C)}:unknown`]);
    expect(cachedMintProbe(C)).toBeUndefined();
    // Not cached, so the next sweep asks again.
    expect(jest.mocked(fetchMintInfo)).toHaveBeenCalledTimes(2);
  });

  it('an aborted sweep stops asking', async () => {
    const controller = new AbortController();
    controller.abort();
    jest.mocked(fetchMintInfo).mockResolvedValue(answered());
    await probeMints(['https://mint.e.example'], { onResult: () => {}, signal: controller.signal });
    expect(jest.mocked(fetchMintInfo)).not.toHaveBeenCalled();
  });
});
