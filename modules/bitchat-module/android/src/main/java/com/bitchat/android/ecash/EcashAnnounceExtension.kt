package com.bitchat.android.ecash

/**
 * Ecash capability beacon TLV (0xF0) appended to bitchat announce packets,
 * plus the per-peer registry of flags parsed from verified inbound announces.
 * Open extension — any bitchat client may implement it; spec draft in
 * `modules/bitchat-module/docs/nut18-bitchat-transport.md`.
 *
 * v2 ("NUTB"): a 6-byte flags-only beacon. It deliberately carries NO key
 * material — the receiver's P2PK lock key and trusted-mint allowlist travel
 * per-send inside the Noise channel as a NUT-18 payment request, so the
 * beacon can never go stale and a static key is never broadcast (it was a
 * cross-nickname correlator). The beacon's only job is the radar affordance:
 * "this peer answers cashu payment-request solicits".
 *
 * Wire format (announce payload is a TLV stream; vanilla bitchat decoders
 * skip unknown TLV types — "tolerant decoder" in IdentityAnnouncement.kt):
 *
 *   type  = 0xF0
 *   len   = 6
 *   value = "NUTB" (4) | version 0x02 (1) | capability flags (1)
 *   flags : bit0 = answers NUT-18 solicits over Noise (0xA0–0xA3)
 *           bit1 = auto-redeems received ecash (radar "instant" badge)
 *           bits 2–7 reserved: 0 on send, ignored on receive
 *
 * Versioning kept minimal: the value layout is append-only (decoders MUST
 * ignore trailing bytes); the version bumps only on incompatible relayout;
 * any version we don't support — including the legacy 40-byte "NUTXX" v1
 * beacon — means the peer is treated as vanilla. The TLV is appended before
 * the announce is signed — exactly how upstream appends its gossip TLV — so
 * the Ed25519 announce signature covers it and vanilla verification still
 * passes. At 6 bytes the beacon also stays far below the 100-byte
 * payload-compression threshold implicated in the cross-platform
 * announce-signature bug.
 *
 * Mirror of ios/EcashAnnounceExtension.swift — keep the two in sync.
 */
object EcashAnnounceExtension {
    const val TLV_TYPE: Byte = 0xF0.toByte()
    const val VERSION: Byte = 0x02
    /** Answers NUT-18 payment-request solicits over the Noise channel. */
    const val CAPABILITY_NUT_REQUESTS: Int = 0x01
    /** Auto-redeems received ecash (informational — drives a radar badge). */
    const val CAPABILITY_AUTO_REDEEM: Int = 0x02
    /** magic(4) + version(1) + flags(1) */
    private const val VALUE_LENGTH = 6
    private val MAGIC = "NUTB".toByteArray(Charsets.US_ASCII)
    /** Backstop against unbounded memory on a hostile mesh (announces are rate-policed upstream). */
    private const val MAX_ENTRIES = 256

    data class PeerExtension(val flags: Int) {
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

    /** Full TLV bytes (type + length + value) for the local announce. */
    fun encodeLocalTLV(flags: Int): ByteArray {
        val out = ByteArray(2 + VALUE_LENGTH)
        out[0] = TLV_TYPE
        out[1] = VALUE_LENGTH.toByte()
        MAGIC.copyInto(out, 2)
        out[6] = VERSION
        out[7] = flags.toByte()
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
     * Walks the announce TLV stream looking for a valid v2 beacon.
     * Tolerant of unknown TLVs (same loop shape as upstream decoders);
     * returns null — peer is vanilla — on missing TLV, bad magic, or an
     * unsupported version (including legacy "NUTXX" v1 beacons).
     */
    fun parse(announcePayload: ByteArray): PeerExtension? {
        var offset = 0
        while (offset + 2 <= announcePayload.size) {
            val tlvType = announcePayload[offset]
            val length = announcePayload[offset + 1].toInt() and 0xFF
            offset += 2
            if (offset + length > announcePayload.size) return null
            if (tlvType == TLV_TYPE) {
                if (length < VALUE_LENGTH) return null
                val value = announcePayload.copyOfRange(offset, offset + length)
                for (i in MAGIC.indices) {
                    if (value[i] != MAGIC[i]) return null
                }
                if (value[4] != VERSION) return null
                // Trailing bytes beyond the flags are future fields — ignored.
                return PeerExtension(flags = value[5].toInt() and 0xFF)
            }
            offset += length
        }
        return null
    }
}
