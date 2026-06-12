package com.bitchat.android.services

import com.bitchat.android.model.ReadReceipt

/**
 * Sovran stub for the vendored bitchat-android MessageRouter (the real one
 * routes between mesh and the excluded NostrTransport). BluetoothMeshService
 * only probes it via `runCatching { tryGetInstance() }` to route geohash read
 * receipts; Sovran routes per-transport in JS, so there is never an instance.
 */
class MessageRouter private constructor() {
    @Suppress("UNUSED_PARAMETER")
    fun sendReadReceipt(receipt: ReadReceipt, recipientPeerID: String) = Unit

    companion object {
        @JvmStatic
        fun tryGetInstance(): MessageRouter? = null
    }
}
