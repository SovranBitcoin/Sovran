package expo.modules.bitchat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Minimal connectedDevice foreground service that pins the app process (and
 * with it the React/Hermes runtime and the BLE mesh) out of cached-app
 * freezing while the mesh is active. Without it, Android freezes the process
 * minutes after backgrounding — no BLE callbacks, no JS, no Nut Drop
 * auto-redeem.
 *
 * Owns NO mesh state: BitChatBLEBridge (a process singleton deliberately
 * independent of the Expo Module instance) keeps driving the mesh; this
 * service only changes the process's scheduling class. Started/stopped by
 * the bridge in start()/stopLocked().
 */
class BitchatMeshForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            else -> startForegroundWithNotification()
        }
        // The bridge restarts the service explicitly with the mesh; a
        // system-restarted service without a running mesh is useless.
        return START_NOT_STICKY
    }

    private fun startForegroundWithNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Nearby mesh",
                    NotificationManager.IMPORTANCE_MIN,
                ).apply {
                    description = "Keeps the nearby mesh listening for messages and payments"
                    setShowBadge(false)
                }
            )
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sovran mesh active")
            .setContentText("Listening for nearby messages and payments")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .apply { contentIntent?.let { setContentIntent(it) } }
            .build()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    companion object {
        private const val TAG = "BitchatMeshFgs"
        private const val CHANNEL_ID = "sovran_mesh"
        private const val NOTIFICATION_ID = 0x534d // "SM"
        private const val ACTION_STOP = "expo.modules.bitchat.MESH_FGS_STOP"

        /** Call only while the app is foregrounded (bridge.start() is). */
        fun start(context: Context) {
            try {
                val intent = Intent(context, BitchatMeshForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                // Background-start restrictions etc. — mesh still works while
                // foregrounded; background delivery degrades gracefully.
                Log.w(TAG, "Failed to start mesh foreground service: ${e.message}")
            }
        }

        fun stop(context: Context) {
            try {
                context.startService(
                    Intent(context, BitchatMeshForegroundService::class.java).apply {
                        action = ACTION_STOP
                    }
                )
            } catch (_: Exception) {
                // Process may already be shutting down — nothing to clean up.
            }
        }
    }
}
