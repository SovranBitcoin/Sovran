package com.bitchat.android.ecash

/**
 * Relay between the vendored mesh stack and `BitChatBLEBridge` for the Nut
 * Drop NUT-18 Noise payloads (solicit / payment request / payment / status).
 *
 * Vendor payload-type range 0xA0–0xA3 — chosen clear of upstream's 0x01–0x11
 * allocations (Android upstream additionally squats 0x20–0x24 for file
 * transfer) and bitchat PR #1053's informally squatted 0x20–0x31. Stock
 * clients drop unknown payload types silently (verified both platforms), so
 * these are invisible outside Sovran-capable peers — and senders only emit
 * them to peers that announced the capability beacon.
 *
 * The native layer is a dumb byte pipe: the patched MessageHandler routes any
 * decrypted Noise payload whose type byte is in the vendor range here, and
 * the bridge forwards the raw bytes to JS, where ALL Cashu semantics live
 * (creq parsing, solicit correlation, payment validation). Unparseable
 * vendor bytes are dropped JS-side.
 *
 * Mirror of ios/NutPayloadRelay.swift — keep the two in sync.
 */
object NutPayloadRelay {
    const val TYPE_FIRST: Int = 0xA0
    const val TYPE_LAST: Int = 0xA3

    fun containsType(type: Int): Boolean = type in TYPE_FIRST..TYPE_LAST

    /**
     * Installed by the bridge on start, cleared on stop (profile switches
     * recreate the mesh service through stop/start, so a stale handler can
     * never deliver payloads across profiles).
     */
    @Volatile
    var onInbound: ((peerID: String, typedPayload: ByteArray, timestampMs: Long) -> Unit)? = null

    /**
     * Called from the patched vendor dispatch with the FULL typed payload
     * (type byte included) of a vendor-range Noise payload.
     */
    fun receive(peerID: String, typedPayload: ByteArray, timestampMs: Long) {
        onInbound?.invoke(peerID, typedPayload, timestampMs)
    }
}
