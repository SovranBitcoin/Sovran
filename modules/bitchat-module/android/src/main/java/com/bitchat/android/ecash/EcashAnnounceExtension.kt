package com.bitchat.android.ecash

/**
 * Ecash capability beacon TLV (0xF0) appended to bitchat announce packets,
 * plus the per-peer registry of flags parsed from verified inbound announces.
 * Open extension — any bitchat client may implement it; spec draft in
 * `modules/bitchat-module/docs/nut18-bitchat-transport.md`.
 *
 * v3 ("NUTB"): a 39-byte beacon carrying the peer's capability flags AND its
 * 33-byte compressed secp256k1 P2PK key ("02" + x-only Nostr pubkey). That
 * single announced key IS the peer's whole Sovran identity — the radar derives
 * the Nostr pubkey (drop the "02" → kind-0 profile → real face), the P2PK lock
 * target, and a stable identity seed all from it. Ecash is locked to that key
 * and broadcast on the public mesh; there is no Noise handshake. (Privacy
 * note: announcing a static key is a cross-nickname correlator — accepted so
 * peer = Nostr = p2pk identity comes for free.)
 *
 * Wire format (announce payload is a TLV stream; vanilla bitchat decoders
 * skip unknown TLV types — "tolerant decoder" in IdentityAnnouncement.kt):
 *
 *   type  = 0xF0
 *   len   = 39
 *   value = "NUTB" (4) | version 0x03 (1) | capability flags (1) | p2pk (33)
 *   flags : bit0 = answers cashu payment requests (legacy/informational)
 *           bit1 = auto-redeems received ecash (radar "instant" badge)
 *           bits 2–7 reserved: 0 on send, ignored on receive
 *   p2pk  : 33-byte compressed secp256k1 key, "02"-prefixed
 *
 * Versioning: the value layout is append-only (decoders MUST ignore trailing
 * bytes); the version bumps only on incompatible relayout; any version we
 * don't support — including the v2 flags-only beacon and the legacy 40-byte
 * "NUTXX" v1 beacon — means the peer is treated as vanilla. The TLV is
 * appended before the announce is signed — exactly how upstream appends its
 * gossip TLV — so the Ed25519 announce signature covers it and vanilla
 * verification still passes. At 39 bytes the beacon stays below the 100-byte
 * payload-compression threshold implicated in the cross-platform
 * announce-signature bug.
 *
 * Mirror of ios/EcashAnnounceExtension.swift — keep the two in sync.
 */
object EcashAnnounceExtension {
    const val TLV_TYPE: Byte = 0xF0.toByte()
    const val VERSION: Byte = 0x03
    /** Answers cashu payment requests (legacy/informational bit). */
    const val CAPABILITY_NUT_REQUESTS: Int = 0x01
    /** Auto-redeems received ecash (informational — drives a radar badge). */
    const val CAPABILITY_AUTO_REDEEM: Int = 0x02
    /** 33-byte compressed secp256k1 P2PK key ("02" + x-only Nostr pubkey). */
    private const val P2PK_LENGTH = 33
    /** Smallest valid value: magic(4) + version(1) + flags(1). */
    private const val MIN_VALUE_LENGTH = 6
    /** Full value with the key: magic(4) + version(1) + flags(1) + p2pk(33). */
    private const val VALUE_LENGTH = MIN_VALUE_LENGTH + P2PK_LENGTH
    private val MAGIC = "NUTB".toByteArray(Charsets.US_ASCII)
    /** Backstop against unbounded memory on a hostile mesh (announces are rate-policed upstream). */
    private const val MAX_ENTRIES = 256

    data class PeerExtension(val flags: Int, val p2pkPubkey: ByteArray?) {
        val supportsNutRequests: Boolean get() = flags and CAPABILITY_NUT_REQUESTS != 0
        val autoRedeem: Boolean get() = flags and CAPABILITY_AUTO_REDEEM != 0
    }

    /**
     * Full TLV bytes for the local announce. Set by BitChatBLEBridge.start()
     * (per-profile by construction — profile switches recreate the mesh
     * service through stop/start), cleared on stop. Read by the patched
     * announce builders in BluetoothMeshService.
     */
    @Volatile
    var localTLV: ByteArray? = null

    private val peers = HashMap<String, PeerExtension>()

    /**
     * Full TLV bytes (type + length + value) for the local announce.
     * [p2pkPubkey] must be the 33-byte "02"-prefixed compressed key.
     */
    fun encodeLocalTLV(flags: Int, p2pkPubkey: ByteArray): ByteArray {
        val out = ByteArray(2 + VALUE_LENGTH)
        out[0] = TLV_TYPE
        out[1] = VALUE_LENGTH.toByte()
        MAGIC.copyInto(out, 2)
        out[6] = VERSION
        out[7] = flags.toByte()
        p2pkPubkey.copyInto(out, 8)
        return out
    }

    /**
     * Records (or clears) the extension for a peer from a VERIFIED announce
     * payload. Announce TLVs are authoritative per-announce: a verified
     * announce without the beacon clears the peer's entry.
     */
    @Synchronized
    fun record(peerID: String, announcePayload: ByteArray) {
        val parsed = parse(announcePayload)
        if (parsed == null) {
            peers.remove(peerID)
            return
        }
        if (!peers.containsKey(peerID) && peers.size >= MAX_ENTRIES) return
        peers[peerID] = parsed
    }

    @Synchronized
    fun lookup(peerID: String): PeerExtension? = peers[peerID]

    @Synchronized
    fun clear() {
        peers.clear()
    }

    /**
     * Walks the announce TLV stream looking for a valid v3 beacon.
     * Tolerant of unknown TLVs (same loop shape as upstream decoders);
     * returns null — peer is vanilla — on missing TLV, bad magic, or an
     * unsupported version (v2 flags-only and legacy "NUTXX" v1 beacons).
     */
    fun parse(announcePayload: ByteArray): PeerExtension? {
        var offset = 0
        while (offset + 2 <= announcePayload.size) {
            val tlvType = announcePayload[offset]
            val length = announcePayload[offset + 1].toInt() and 0xFF
            offset += 2
            if (offset + length > announcePayload.size) return null
            if (tlvType == TLV_TYPE) {
                if (length < MIN_VALUE_LENGTH) return null
                val value = announcePayload.copyOfRange(offset, offset + length)
                for (i in MAGIC.indices) {
                    if (value[i] != MAGIC[i]) return null
                }
                if (value[4] != VERSION) return null
                val flags = value[5].toInt() and 0xFF
                // The key is append-only; read it when present and well-formed.
                val p2pkPubkey = if (length >= VALUE_LENGTH && value[6] == 0x02.toByte()) {
                    value.copyOfRange(6, VALUE_LENGTH)
                } else {
                    null
                }
                return PeerExtension(flags = flags, p2pkPubkey = p2pkPubkey)
            }
            offset += length
        }
        return null
    }
}
