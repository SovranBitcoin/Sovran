package com.bitchat.android.ui

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.bitchat.android.util.NotificationIntervalManager

/**
 * Sovran stub for the vendored bitchat-android NotificationManager (the real
 * one lives in the excluded Compose UI layer). BluetoothMeshService only uses
 * it to surface background-DM notifications when no delegate is attached;
 * Sovran's bridge is always attached while the mesh runs (foreground-only),
 * and notification UX belongs to the app layer. Same trick as iOS TorStub.
 */
class NotificationManager(
    @Suppress("UNUSED_PARAMETER") context: Context,
    @Suppress("UNUSED_PARAMETER") notificationManager: NotificationManagerCompat,
    @Suppress("UNUSED_PARAMETER") notificationIntervalManager: NotificationIntervalManager,
) {
    fun setAppBackgroundState(@Suppress("UNUSED_PARAMETER") inBackground: Boolean) = Unit

    fun showPrivateMessageNotification(
        @Suppress("UNUSED_PARAMETER") senderPeerID: String,
        @Suppress("UNUSED_PARAMETER") senderNickname: String,
        @Suppress("UNUSED_PARAMETER") messageContent: String,
    ) = Unit
}
