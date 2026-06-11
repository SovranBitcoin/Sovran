package com.bitchat.android.sovran

/**
 * Sovran extension TLV appended to bitchat announce packets, plus the
 * per-peer registry of extensions parsed from verified inbound announces.
 *
 * Wire format (announce payload is a TLV stream; vanilla bitchat decoders
 * skip unknown TLV types — "tolerant decoder" in IdentityAnnouncement.kt):
 *
 *   type  = 0xF0
 *   len   = 39
 *   value = "SVRN" (4) | version 0x01 (1) | capability flags (1)
 *           | P2PK pubkey (33 = 0x02 || nostr x-only pubkey)
 *
 * 0xF0 sits far above upstream's sequential allocation (0x01–0x04 today; the
 * bitpoints.me fork already collided at 0x04) to stay out of landgrab
 * territory. The TLV is appended before the announce is signed — exactly how
 * upstream appends its gossip TLV (0x04) — so the Ed25519 announce signature
 * covers it and vanilla verification still passes. Decoders accept
 * len >= 39 so future versions can append fields.
 *
 * Mirror of ios/SovranAnnounceExtension.swift — keep the two in sync.
 */
object SovranAnnounceExtension {
    const val TLV_TYPE: Byte = 0xF0.toByte()
    const val VERSION: Byte = 0x01
    /** Capability bit 0: auto-redeems P2PK-locked cashu tokens from the public mesh. */
    const val CAPABILITY_CASHU_AUTO_REDEEM: Int = 0x01
    /** magic(4) + version(1) + flags(1) + compressed pubkey(33) */
    private const val VALUE_LENGTH = 39
    private val MAGIC = "SVRN".toByteArray(Charsets.US_ASCII)
    /** Backstop against unbounded memory on a hostile mesh (announces are rate-policed upstream). */
    private const val MAX_ENTRIES = 256

    data class PeerExtension(val flags: Int, val p2pkPubkeyHex: String)

    /**
     * Full TLV bytes for the local announce. Set by BitChatBLEBridge.start()
     * (per-profile by construction — profile switches recreate the mesh
     * service through stop/start), cleared on stop. Read by the patched
     * announce builders in BluetoothMeshService.
     */
    @Volatile
    var localTLV: ByteArray? = null

    private val peers = HashMap<String, PeerExtension>()

    /** Builds the TLV, or null when the pubkey is not a 33-byte `0x02`-prefixed key. */
    fun encodeLocalTLV(p2pkPubkey: ByteArray, flags: Int): ByteArray? {
        if (p2pkPubkey.size != 33 || p2pkPubkey[0] != 0x02.toByte()) return null
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
     * announce without the SVRN TLV clears the peer's entry.
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
     * Walks the announce TLV stream looking for a valid SVRN extension.
     * Tolerant of unknown TLVs (same loop shape as upstream decoders);
     * returns null on missing TLV, bad magic, or malformed pubkey.
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
                // value[4] is the version — fields are fixed-offset for all
                // versions, so unknown future versions still parse.
                val flags = value[5].toInt() and 0xFF
                val pubkey = value.copyOfRange(6, 39)
                if (pubkey[0] != 0x02.toByte()) return null
                return PeerExtension(
                    flags = flags,
                    p2pkPubkeyHex = pubkey.joinToString("") { "%02x".format(it) }
                )
            }
            offset += length
        }
        return null
    }
}
