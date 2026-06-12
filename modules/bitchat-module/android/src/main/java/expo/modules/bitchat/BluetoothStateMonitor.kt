package expo.modules.bitchat

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Reports the unified Bluetooth state vocabulary shared with iOS
 * (ios/BitChatBLEBridge.swift bluetoothState):
 * poweredOn | poweredOff | unauthorized | unsupported | unknown.
 *
 * Sources: a BroadcastReceiver on ACTION_STATE_CHANGED for adapter on/off,
 * plus on-demand recomputation (permission grants don't broadcast — the
 * module re-checks on host-resume).
 */
class BluetoothStateMonitor(private val context: Context) {

    var onStateChanged: ((String) -> Unit)? = null

    private var receiver: BroadcastReceiver? = null

    companion object {
        /** Runtime permissions the mesh needs at the current API level. */
        fun requiredPermissions(): List<String> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                listOf(
                    Manifest.permission.BLUETOOTH_SCAN,
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_ADVERTISE,
                )
            } else {
                listOf(Manifest.permission.ACCESS_FINE_LOCATION)
            }

        fun hasPermissions(context: Context): Boolean =
            requiredPermissions().all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
    }

    fun currentState(): String {
        val adapter = adapter() ?: return "unsupported"
        if (!hasPermissions(context)) return "unauthorized"
        val enabled = try {
            adapter.isEnabled
        } catch (_: SecurityException) {
            return "unauthorized"
        }
        return if (enabled) "poweredOn" else "poweredOff"
    }

    fun start() {
        if (receiver != null) return
        val stateReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                    onStateChanged?.invoke(currentState())
                }
            }
        }
        receiver = stateReceiver
        ContextCompat.registerReceiver(
            context,
            stateReceiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED,
        )
    }

    fun stop() {
        receiver?.let { context.unregisterReceiver(it) }
        receiver = null
    }

    /** Re-check and notify — used when returning from Settings/permission dialogs. */
    fun refresh() {
        onStateChanged?.invoke(currentState())
    }

    private fun adapter(): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
}
