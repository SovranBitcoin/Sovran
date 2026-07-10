/**
 * @jest-environment node
 */

import type { Manager } from '@cashu/coco-core';
import {
  Amount,
  blindMessage,
  constructUnblindedSignature,
  createBlindSignature,
  createDLEQProof,
  getEncodedToken,
  getPubKeyFromPrivKey,
  pointFromBytes,
  type HasKeysetKeys,
  type Proof,
} from '@cashu/cashu-ts';

import {
  OfflineReceiveDleqError,
  requireOfflineTokenDleq,
  requirePreparedOfflineReceiveDleq,
} from '@/shared/lib/cashu/offlineReceiveDleq';

const MINT_URL = 'https://mint.example';

function fixtureHexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{2}/g) ?? [];
  return Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16));
}

function fixtureBytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToNumber(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

function numberToHexPadded64(scalar: bigint): string {
  return scalar.toString(16).padStart(64, '0');
}

function makeProofFixture(): { keyset: HasKeysetKeys; proof: Proof } {
  const privateKey = fixtureHexToBytes('1'.padStart(64, '0'));
  const publicKey = pointFromBytes(getPubKeyFromPrivKey(privateKey));
  const secret = new TextEncoder().encode('sovran-dleq-boundary-fixture');
  const blindingFactor = hexToNumber('123456'.padStart(64, '0'));
  const blindedMessage = blindMessage(secret, blindingFactor);
  const dleq = createDLEQProof(blindedMessage.B_, privateKey);
  const blindSignature = createBlindSignature(blindedMessage.B_, privateKey, '00');
  const unblinded = constructUnblindedSignature(blindSignature, blindingFactor, secret, publicKey);

  return {
    proof: {
      id: unblinded.id,
      amount: Amount.from(1),
      C: unblinded.C.toHex(true),
      secret: new TextDecoder().decode(unblinded.secret),
      dleq: {
        e: fixtureBytesToHex(dleq.e),
        s: fixtureBytesToHex(dleq.s),
        r: numberToHexPadded64(blindingFactor),
      },
    },
    keyset: {
      id: unblinded.id,
      keys: { '1': publicKey.toHex(true) },
    },
  };
}

function managerWithKeysets(keysets: readonly HasKeysetKeys[]): Manager {
  const keyChain = {
    getAllKeysetIds: () => keysets.map((keyset) => keyset.id),
    getKeyset: (id: string) => {
      const keyset = keysets.find((candidate) => candidate.id === id);
      if (!keyset) throw new Error(`Unknown keyset ${id}`);
      return keyset;
    },
  };
  return Object.assign(Object.create(null), {
    walletService: {
      getWallet: jest.fn().mockResolvedValue({ keyChain }),
    },
  });
}

function preparedBatch(proofs: Proof[]) {
  return { inputProofs: proofs, mintUrl: MINT_URL, unit: 'sat' };
}

async function expectFailure(
  promise: Promise<void>,
  reason: OfflineReceiveDleqError['reason']
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'OfflineReceiveDleqError',
    reason,
  });
}

describe('offline receive DLEQ boundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a proof carrying a valid DLEQ from the cached mint keyset', async () => {
    const { keyset, proof } = makeProofFixture();

    await expect(
      requirePreparedOfflineReceiveDleq(managerWithKeysets([keyset]), preparedBatch([proof]))
    ).resolves.toBeUndefined();
  });

  it('rejects a proof without DLEQ', async () => {
    const { keyset, proof } = makeProofFixture();
    const { dleq: _dleq, ...proofWithoutDleq } = proof;

    await expectFailure(
      requirePreparedOfflineReceiveDleq(
        managerWithKeysets([keyset]),
        preparedBatch([proofWithoutDleq])
      ),
      'missing-dleq'
    );
  });

  it('rejects a proof without the DLEQ blinding factor', async () => {
    const { keyset, proof } = makeProofFixture();
    const proofWithoutR: Proof = {
      ...proof,
      dleq: { e: proof.dleq!.e, s: proof.dleq!.s },
    };

    await expectFailure(
      requirePreparedOfflineReceiveDleq(
        managerWithKeysets([keyset]),
        preparedBatch([proofWithoutR])
      ),
      'missing-blinding-factor'
    );
  });

  it('rejects a proof whose keyset is not cached', async () => {
    const { proof } = makeProofFixture();

    await expectFailure(
      requirePreparedOfflineReceiveDleq(managerWithKeysets([]), preparedBatch([proof])),
      'missing-keyset'
    );
  });

  it('rejects a proof when its cached keyset lacks the amount key', async () => {
    const { keyset, proof } = makeProofFixture();
    const keysetWithoutAmount: HasKeysetKeys = {
      ...keyset,
      keys: { '2': keyset.keys['1'] },
    };

    await expectFailure(
      requirePreparedOfflineReceiveDleq(
        managerWithKeysets([keysetWithoutAmount]),
        preparedBatch([proof])
      ),
      'missing-amount-key'
    );
  });

  it('rejects a proof when the cached amount key belongs to a different mint key', async () => {
    const { keyset, proof } = makeProofFixture();
    const wrongPrivateKey = fixtureHexToBytes('2'.padStart(64, '0'));
    const wrongPublicKey = pointFromBytes(getPubKeyFromPrivKey(wrongPrivateKey));
    const wrongKeyset: HasKeysetKeys = {
      ...keyset,
      keys: { '1': wrongPublicKey.toHex(true) },
    };

    await expectFailure(
      requirePreparedOfflineReceiveDleq(managerWithKeysets([wrongKeyset]), preparedBatch([proof])),
      'invalid-dleq'
    );
  });

  it.each([
    {
      name: 'e',
      tamper: (proof: Proof): Proof => ({
        ...proof,
        dleq: { ...proof.dleq!, e: '00'.repeat(32) },
      }),
    },
    {
      name: 's',
      tamper: (proof: Proof): Proof => ({
        ...proof,
        dleq: { ...proof.dleq!, s: '00'.repeat(32) },
      }),
    },
    {
      name: 'r',
      tamper: (proof: Proof): Proof => ({
        ...proof,
        dleq: { ...proof.dleq!, r: '01'.repeat(32) },
      }),
    },
    {
      name: 'C',
      tamper: (proof: Proof): Proof => ({
        ...proof,
        C: `${proof.C.startsWith('02') ? '03' : '02'}${proof.C.slice(2)}`,
      }),
    },
    {
      name: 'secret',
      tamper: (proof: Proof): Proof => ({
        ...proof,
        secret: `${proof.secret}-tampered`,
      }),
    },
  ])('rejects a proof with tampered $name', async ({ tamper }) => {
    const { keyset, proof } = makeProofFixture();

    await expectFailure(
      requirePreparedOfflineReceiveDleq(
        managerWithKeysets([keyset]),
        preparedBatch([tamper(proof)])
      ),
      'invalid-dleq'
    );
  });

  it('rejects a multi-proof token when any one proof is invalid', async () => {
    const { keyset, proof } = makeProofFixture();
    const invalidProof: Proof = { ...proof, secret: `${proof.secret}-tampered` };

    await expectFailure(
      requirePreparedOfflineReceiveDleq(
        managerWithKeysets([keyset]),
        preparedBatch([proof, invalidProof])
      ),
      'invalid-dleq'
    );
  });

  it('verifies the encoded-token path used by offline transports', async () => {
    const { keyset, proof } = makeProofFixture();
    const token = getEncodedToken({ mint: MINT_URL, proofs: [proof], unit: 'sat' });

    await expect(
      requireOfflineTokenDleq(managerWithKeysets([keyset]), token, MINT_URL)
    ).resolves.toBeUndefined();
  });
});
