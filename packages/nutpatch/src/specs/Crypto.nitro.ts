import { type HybridObject } from 'react-native-nitro-modules'

export interface Crypto extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  hashToCurve(message: ArrayBuffer): ArrayBuffer
  blind(message: ArrayBuffer, blindingFactor: ArrayBuffer): ArrayBuffer
  unblind(
    blindedSignature: ArrayBuffer,
    blindingFactor: ArrayBuffer,
    mintPubkey: ArrayBuffer
  ): ArrayBuffer

  computeSha256(message: ArrayBuffer): ArrayBuffer
  hashE(pubkeys: ArrayBuffer[]): ArrayBuffer

  schnorrSign(seckey: ArrayBuffer, msg: ArrayBuffer): ArrayBuffer
  schnorrVerify(sig: ArrayBuffer, msg: ArrayBuffer, xonlyPubkey: ArrayBuffer): boolean

  seckeyGenerate(): ArrayBuffer
  createBlindSignature(B_: ArrayBuffer, seckey: ArrayBuffer): ArrayBuffer

  verifyDleqProof(
    B_: ArrayBuffer,
    C_: ArrayBuffer,
    A: ArrayBuffer,
    s: ArrayBuffer,
    e: ArrayBuffer
  ): boolean
  createDleqProof(B_: ArrayBuffer, seckey: ArrayBuffer): ArrayBuffer

  /**
   * Batch-derive NUT-13 legacy keyset secrets and blinding factors.
   * Path: m/129372'/0'/{keysetIdInt}'/{counter}'/{0|1}
   *
   * @returns (count * 64) bytes: for each counter, 32 bytes secret + 32 bytes blinding.
   */
  batchDeriveLegacy(
    seed: ArrayBuffer,
    keysetIdInt: number,
    startCounter: number,
    count: number
  ): ArrayBuffer
}
