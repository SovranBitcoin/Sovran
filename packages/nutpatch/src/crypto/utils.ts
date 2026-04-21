import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/curves/utils.js'

export function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export function toPoint(buf: ArrayBuffer): WeierstrassPoint<bigint> {
  return secp256k1.Point.fromHex(bytesToHex(new Uint8Array(buf)))
}

export function bigintToBuffer(n: bigint): ArrayBuffer {
  const buf = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return buf.buffer as ArrayBuffer
}
