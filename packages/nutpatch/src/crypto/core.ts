import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes, bytesToHex, hexToBytes } from '@noble/curves/utils.js'
import { NitroModules } from 'react-native-nitro-modules'
import type { Crypto } from '../specs/Crypto.nitro'
import { toBuffer, toPoint, bigintToBuffer } from './utils'

export type PrivKey = Uint8Array | string
export type DigestInput = Uint8Array | string

export type BlindSignature = {
  C_: WeierstrassPoint<bigint>
  id: string
}

export type RawBlindedMessage = {
  B_: WeierstrassPoint<bigint>
  r: bigint
  secret: Uint8Array
}

export type DLEQ = {
  s: Uint8Array
  e: Uint8Array
  r?: bigint
}

export type UnblindedSignature = {
  C: WeierstrassPoint<bigint>
  secret: Uint8Array
  id: string
}

let _instance: Crypto | null = null
function getInstance(): Crypto {
  if (!_instance) {
    _instance = NitroModules.createHybridObject<Crypto>('Crypto')
  }
  return _instance
}


export function hashToCurve(secret: Uint8Array): WeierstrassPoint<bigint> {
  return toPoint(getInstance().hashToCurve(toBuffer(secret)))
}

export function blindMessage(secret: Uint8Array, r?: bigint): RawBlindedMessage {
  const scalar: bigint = r ?? secp256k1.Point.Fn.fromBytes(secp256k1.utils.randomSecretKey())
  const B_ = toPoint(getInstance().blind(toBuffer(secret), bigintToBuffer(scalar)))
  return { B_, r: scalar, secret }
}

export function unblindSignature(
  C_: WeierstrassPoint<bigint>,
  r: bigint,
  A: WeierstrassPoint<bigint>,
): WeierstrassPoint<bigint> {
  return toPoint(
    getInstance().unblind(
      toBuffer(C_.toBytes(true)),
      bigintToBuffer(r),
      toBuffer(A.toBytes(true)),
    ),
  )
}

export function hash_e(pubkeys: Array<WeierstrassPoint<bigint>>): Uint8Array {
  const e_ = pubkeys.map((p) => p.toHex(false)).join('')
  return sha256(new TextEncoder().encode(e_))
}

export function pointFromBytes(bytes: Uint8Array): WeierstrassPoint<bigint> {
  return secp256k1.Point.fromHex(bytesToHex(bytes))
}

export function pointFromHex(hex: string): WeierstrassPoint<bigint> {
  return secp256k1.Point.fromHex(hex)
}

export function createRandomSecretKey(): Uint8Array {
  return secp256k1.utils.randomSecretKey()
}

export function createBlindSignature(
  B_: WeierstrassPoint<bigint>,
  privateKey: Uint8Array,
  id: string,
): BlindSignature {
  const a = secp256k1.Point.Fn.fromBytes(privateKey)
  const C_: WeierstrassPoint<bigint> = B_.multiply(a)
  return { C_, id }
}

export function createRandomRawBlindedMessage(): RawBlindedMessage {
  const secretStr = bytesToHex(randomBytes(32))
  const secretBytes = new TextEncoder().encode(secretStr)
  return blindMessage(secretBytes)
}

export function constructUnblindedSignature(
  blindSig: BlindSignature,
  r: bigint,
  secret: Uint8Array,
  key: WeierstrassPoint<bigint>,
): UnblindedSignature {
  const C = unblindSignature(blindSig.C_, r, key)
  return { id: blindSig.id, secret, C }
}

export function getKeysetIdInt(keysetId: string): bigint {
  if (/^[a-fA-F0-9]+$/.test(keysetId)) {
    let n = BigInt('0x' + keysetId)
    return n % BigInt(2 ** 31 - 1)
  }
  // legacy base64
  const bytes = Uint8Array.from(atob(keysetId), (c) => c.charCodeAt(0))
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n % BigInt(2 ** 31 - 1)
}

export function computeMessageDigest(message: string): Uint8Array
export function computeMessageDigest(message: string, asHex: false): Uint8Array
export function computeMessageDigest(message: string, asHex: true): string
export function computeMessageDigest(message: string, asHex = false): string | Uint8Array {
  const hashBytes = sha256(new TextEncoder().encode(message))
  return asHex ? bytesToHex(hashBytes) : hashBytes
}

export const schnorrSignDigest = (digest: DigestInput, privateKey: PrivKey): string => {
  const digestBytes = typeof digest === 'string' ? hexToBytes(digest) : digest
  const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey
  return bytesToHex(schnorr.sign(digestBytes, privKeyBytes))
}

export const schnorrSignMessage = (message: string, privateKey: PrivKey): string => {
  return schnorrSignDigest(computeMessageDigest(message), privateKey)
}

export const schnorrVerifyMessage = (
  signature: string,
  message: string,
  pubkey: string,
  throws: boolean = false,
): boolean => {
  try {
    const msghash = computeMessageDigest(message)
    const pubkeyX = pubkey.length === 66 ? pubkey.slice(2) : pubkey
    return schnorr.verify(hexToBytes(signature), msghash, hexToBytes(pubkeyX))
  } catch (e) {
    if (throws) throw e
  }
  return false
}

export function getValidSigners(
  signatures: string[],
  message: string,
  pubkeys: string[],
): string[] {
  const uniquePubs = Array.from(new Set(pubkeys))
  return uniquePubs.filter((pubkey) =>
    signatures.some((sig) => schnorrVerifyMessage(sig, message, pubkey)),
  )
}

export const meetsSignerThreshold = (
  signatures: string[],
  message: string,
  pubkeys: string[],
  threshold: number = 1,
): boolean => {
  return getValidSigners(signatures, message, pubkeys).length >= threshold
}
