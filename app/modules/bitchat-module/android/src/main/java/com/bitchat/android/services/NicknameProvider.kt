package com.bitchat.android.services

import android.content.Context

/**
 * Sovran stub for the vendored bitchat-android NicknameProvider (the real one
 * reads the excluded Compose DataManager). BluetoothMeshService calls this
 * when building announce packets; BitChatBLEBridge sets [currentNickname]
 * from the JS `startBLE(nickname, …)` call.
 */
object NicknameProvider {
    @Volatile
    var currentNickname: String? = null

    fun getNickname(@Suppress("UNUSED_PARAMETER") context: Context, myPeerID: String): String {
        val nickname = currentNickname
        return if (nickname.isNullOrBlank()) myPeerID else nickname
    }
}
