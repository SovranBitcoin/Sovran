/**
 * The two local keyset reads the app makes through Coco's private keyset
 * repository: the units a mint holds keys for, and each keyset's fee.
 */
import type { Manager } from '@cashu/coco-core';

import { getMintKeysetFees, getMintKeysetUnits } from '@/shared/lib/cashu/managerInternals';

jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { cashuLog: log, initPhase: jest.fn(), mintUrlLogFields: () => ({}) };
});
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({ reportCocoApiFailure: jest.fn() }));

const MINT = 'https://mint.example';

function managerWith(keysets: unknown[] | Error): Manager {
  const getKeysetsByMintUrl = jest.fn(async (url: string) => {
    if (keysets instanceof Error) throw keysets;
    return url === MINT ? keysets : [];
  });
  return { mintService: { keysetRepo: { getKeysetsByMintUrl } } } as unknown as Manager;
}

const KEYSETS = [
  { id: '00a', unit: 'sat', active: true, feePpk: 100, keypairs: { 1: 'k' } },
  { id: '00b', unit: 'USD', active: false, feePpk: 0, keypairs: { 1: 'k' } },
  { id: '00c', unit: 'eur', active: true, feePpk: 0, keypairs: {} },
  { id: '00d', active: true, keypairs: { 1: 'k' } },
];

it('lists the units a mint holds keys for, lower-cased, sat when unset, once each', async () => {
  await expect(getMintKeysetUnits(managerWith(KEYSETS), MINT)).resolves.toEqual(['sat', 'usd']);
});

it('lists each keyset with only its id, unit, active flag and fee', async () => {
  await expect(getMintKeysetFees(managerWith(KEYSETS), MINT)).resolves.toEqual([
    { id: '00a', unit: 'sat', active: true, feePpk: 100 },
    { id: '00b', unit: 'USD', active: false, feePpk: 0 },
    { id: '00c', unit: 'eur', active: true, feePpk: 0 },
    { id: '00d', unit: undefined, active: true, feePpk: undefined },
  ]);
});

it('throws when the read fails', async () => {
  const failure = new Error('db closed');
  await expect(getMintKeysetUnits(managerWith(failure), MINT)).rejects.toBe(failure);
  await expect(getMintKeysetFees(managerWith(failure), MINT)).rejects.toBe(failure);
});
