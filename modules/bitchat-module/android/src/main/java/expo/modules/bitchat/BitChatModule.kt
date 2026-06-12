package expo.modules.bitchat

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_ENABLE_BT = 0x42B7

/**
 * Kotlin counterpart of ios/BitChatModule.swift — same module name, function
 * signatures, event names, and payload shapes, so src/BitChatModule.ts works
 * unchanged on Android. Adds the cross-platform Bluetooth helpers
 * (requestEnableBluetooth / openBluetoothSettings); on iOS those are handled
 * in the JS wrapper via Linking.openSettings().
 */
class BitChatModule : Module() {

    private var pendingEnableRequest: Promise? = null

    override fun definition() = ModuleDefinition {
        Name("BitChat")

        Events(
            "onBLEMessage",
            "onBLEPrivateMessage",
            "onBLEDeliveryStatus",
            "onBLEPeerUpdate",
            "onBLEStateChanged",
            "onBLEBackgroundTaskExpiring",
            "onNostrMessage",
            "onNostrPrivateMessage",
            "onNutPayload",
        )

        OnCreate {
            val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
            val emit: (String, Map<String, Any?>) -> Unit = { name, body -> sendEvent(name, body) }
            BitChatBLEBridge.attach(context, emit)
            BitChatNostrBridge.attach(context, emit)
        }

        OnDestroy {
            BitChatBLEBridge.detach()
            BitChatNostrBridge.detach()
        }

        OnActivityEntersForeground {
            // Permission grants don't broadcast — re-derive the state when the
            // user returns from the permission dialog or Settings.
            BitChatBLEBridge.refreshBluetoothState()
        }

        // --- BLE Mesh ---

        AsyncFunction("startBLE") {
                nickname: String,
                profileScope: String,
                noisePrivateKeyHex: String,
                signingPrivateKeyHex: String,
                p2pkPubkeyHex: String,
            ->
            BitChatBLEBridge.start(nickname, profileScope, noisePrivateKeyHex, signingPrivateKeyHex, p2pkPubkeyHex)
        }

        AsyncFunction("sendBLEMessage") { content: String ->
            BitChatBLEBridge.sendMessage(content)
        }

        AsyncFunction("startBLEPrivateChat") { peerID: String ->
            BitChatBLEBridge.startPrivateChat(peerID)
        }

        AsyncFunction("resetBLEPrivateChat") { peerID: String ->
            BitChatBLEBridge.resetPrivateChat(peerID)
        }

        AsyncFunction("sendBLEPrivateMessage") {
                peerID: String,
                content: String,
                nickname: String,
                messageID: String,
            ->
            BitChatBLEBridge.sendPrivateMessage(content, peerID, nickname, messageID)
        }

        Function("getBLEPeers") {
            BitChatBLEBridge.getPeers()
        }

        // Send a Nut Drop vendor Noise payload (raw typed bytes, 0xA0–0xA3)
        // to a peer over the established Noise session. The native layer is a
        // dumb byte pipe — payload semantics (solicit / request / payment /
        // status) live entirely in JS. Inbound counterparts arrive via the
        // `onNutPayload` event.
        AsyncFunction("nutSendPayload") { peerID: String, payloadBase64: String ->
            BitChatBLEBridge.sendNutPayload(peerID, payloadBase64)
        }

        Function("getBLEDmHistory") { profileScope: String ->
            BitChatBLEBridge.getDmHistory(appContext.reactContext, profileScope)
        }

        Function("getBLEState") {
            BitChatBLEBridge.bluetoothState()
        }

        // iOS-only background-task assertions; the mesh foreground service
        // already keeps the process alive on Android, so these are no-ops
        // kept for a platform-uniform JS API.
        AsyncFunction("beginBLEBackgroundTask") { _: String ->
            -1
        }

        AsyncFunction("endBLEBackgroundTask") { _: Int ->
        }

        // --- Bluetooth helpers (Android-only natively; iOS falls back in JS) ---

        AsyncFunction("requestEnableBluetooth") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            try {
                pendingEnableRequest?.resolve(false)
                pendingEnableRequest = promise
                activity.startActivityForResult(
                    Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE),
                    REQUEST_ENABLE_BT,
                )
            } catch (_: SecurityException) {
                // BLUETOOTH_CONNECT not granted (API 31+) — the JS notice flow
                // requests permissions before offering the enable button.
                pendingEnableRequest = null
                promise.resolve(false)
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode == REQUEST_ENABLE_BT) {
                pendingEnableRequest?.resolve(payload.resultCode == Activity.RESULT_OK)
                pendingEnableRequest = null
                BitChatBLEBridge.refreshBluetoothState()
            }
        }

        AsyncFunction("openBluetoothSettings") {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            val activity = appContext.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
        }

        // --- Nostr (geohash chat via vendored relay manager) ---

        AsyncFunction("startNostr") { profileScope: String ->
            BitChatNostrBridge.start(profileScope)
        }

        AsyncFunction("joinGeohash") { geohash: String ->
            BitChatNostrBridge.joinGeohash(geohash)
        }

        AsyncFunction("leaveGeohash") {
            BitChatNostrBridge.leaveGeohash()
        }

        AsyncFunction("sendGeohashMessage") { content: String, nickname: String ->
            BitChatNostrBridge.sendMessage(content, nickname.takeIf { it.isNotEmpty() })
        }

        AsyncFunction("sendGeohashPrivateMessage") { recipientPubkey: String, content: String ->
            BitChatNostrBridge.sendPrivateMessage(recipientPubkey, content)
        }
    }
}
