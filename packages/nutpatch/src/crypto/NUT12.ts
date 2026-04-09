import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { NitroModules } from 'react-native-nitro-modules'
import type { Crypto } from '../specs/Crypto.nitro'
import type { DLEQ } from './core'
import { hashToCurve } from './core'
import { toBuffer } from './utils'

let _instance: Crypto | null = null
function getInstance(): Crypto {
  if (!_instance) {
    _instance = NitroModules.createHybridObject<Crypto>('Crypto')
  }
  return _instance
}

export const verifyDLEQProof = (
  dleq: DLEQ,
  B_: WeierstrassPoint<bigint>,
  C_: WeierstrassPoint<bigint>,
  A: WeierstrassPoint<bigint>,
): boolean => {
  return getInstance().verifyDleqProof(
    toBuffer(B_.toBytes(true)),
    toBuffer(C_.toBytes(true)),
    toBuffer(A.toBytes(true)),
    toBuffer(dleq.s),
    toBuffer(dleq.e),
  )
}

export const verifyDLEQProof_reblind = (
  secret: Uint8Array,
  dleq: DLEQ,
  C: WeierstrassPoint<bigint>,
  A: WeierstrassPoint<bigint>,
): boolean => {
  if (dleq.r === undefined)
    throw new Error('verifyDLEQProof_reblind: Undefined blinding factor')

  const Y = hashToCurve(secret)
  const C_ = C.add(A.multiply(dleq.r))
  const bG = secp256k1.Point.BASE.multiply(dleq.r)
  const B_ = Y.add(bG)

  return verifyDLEQProof(dleq, B_, C_, A)
}

export const createDLEQProof = (
  B_: WeierstrassPoint<bigint>,
  a: Uint8Array,
): DLEQ => {
  const result = new Uint8Array(
    getInstance().createDleqProof(toBuffer(B_.toBytes(true)), toBuffer(a)),
  )
  return {
    s: result.slice(0, 32),
    e: result.slice(32, 64),
  }
}
