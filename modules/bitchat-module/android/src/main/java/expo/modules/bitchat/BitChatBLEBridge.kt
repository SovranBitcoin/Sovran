package expo.modules.bitchat

import android.content.Context
import android.util.Log
import com.bitchat.android.mesh.BluetoothMeshDelegate
import com.bitchat.android.mesh.BluetoothMeshService
import com.bitchat.android.model.BitchatMessage
import com.bitchat.android.noise.NoiseSession
import com.bitchat.android.services.NicknameProvider
import com.bitchat.android.ecash.EcashAnnounceExtension
import com.bitchat.android.ecash.NutPayloadRelay
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class BitChatNotStartedException :
    Exception("BLE mesh is not started. Call startBLE() first.")

class BitChatInvalidPeerException : Exception("Invalid peer ID (expected 16-char hex).")

class BitChatUnauthorizedException :
    Exception("Bluetooth permissions are not granted. Request them before startBLE().")

class BitChatInvalidNutPayloadException :
    Exception("Invalid NUT payload (expected base64 bytes starting 0xA0–0xA3).")

/**
 * Bridges the vendored bitchat-android BluetoothMeshService to the Expo module
 * event system — the Kotlin counterpart of ios/BitChatBLEBridge.swift, with
 * the same event names and payload shapes.
 *
 * A singleton deliberately independent of the Module instance: a future
 * foreground Service can drive this same controller without JS-API changes
 * (Android BLE is foreground-only for now).
 *
 * Behavioral differences vs the vendor it has to absorb:
 * - The vendor's sendPrivateMessage is fire-and-forget when no Noise session
 *   exists (it triggers a handshake and DROPS the content,
 *   BluetoothMeshService.kt sendPrivateMessage else-branch). The bridge owns a
 *   pending-send queue keyed by peerID, flushed on
 *   EncryptionService.onSessionEstablished, with a 12s handshake cap — the JS
 *   15s watchdog in useBitChat.ts remains the outer guard.
 * - Inbound DMs are auto-acked by the vendor's MessageHandler — unlike iOS, no
 *   manual delivery ack here.
 * - There is no vendor DeliveryStatus delegate; `sending`/`sent` are
 *   synthesized here, `delivered`/`read` map from didReceiveDeliveryAck /
 *   didReceiveReadReceipt.
 */
object BitChatBLEBridge : BluetoothMeshDelegate {

    private const val TAG = "BitChatBLEBridge"
    private const val DM_SUMMARIES_PREFS = "bitchat_dm_summaries"
    private const val DM_SUMMARIES_KEY = "bitchat.dmPeerSummaries"
    private const val HANDSHAKE_TIMEOUT_MS = 12_000L
    private const val MESSAGE_WAKE_LOCK_MS = 30_000L
    private val PEER_ID_RE = Regex("^[0-9a-fA-F]{16}$")

    private data class DmPeerSummary(
        var peerID: String,
        var nickname: String?,
        var lastTimestamp: Double,
    )

    private data class PendingSend(
        val content: String,
        val messageID: String,
        val enqueuedAtMs: Long,
    )

    var emitter: ((name: String, body: Map<String, Any?>) -> Unit)? = null

    private var appContext: Context? = null
    private var mesh: BluetoothMeshService? = null
    private var stateMonitor: BluetoothStateMonitor? = null
    private var isRunning = false
    private var activeScopeSuffix: String? = null
    private var activeIdentityID: String? = null
    private var activeNickname: String? = null

    private val gson = Gson()
    private val lock = Any()
    private var dmSummaries: MutableMap<String, DmPeerSummary> = mutableMapOf()
    private val pendingSends: MutableMap<String, MutableList<PendingSend>> = mutableMapOf()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // MARK: - Lifecycle

    fun attach(context: Context, emit: (String, Map<String, Any?>) -> Unit) {
        appContext = context.applicationContext
        emitter = emit
        if (stateMonitor == null) {
            stateMonitor = BluetoothStateMonitor(context.applicationContext).also { monitor ->
                monitor.onStateChanged = { state ->
                    emitter?.invoke("onBLEStateChanged", mapOf("state" to state))
                }
                monitor.start()
            }
        }
    }

    fun detach() {
        stop()
        stateMonitor?.stop()
        stateMonitor = null
        emitter = null
        appContext = null
    }

    fun bluetoothState(): String = stateMonitor?.currentState() ?: "unknown"

    fun refreshBluetoothState() {
        stateMonitor?.refresh()
    }

    /**
     * Same idempotency contract as iOS BitChatBLEBridge.start: same scope +
     * same identity → re-apply nickname only; anything else → stop + recreate.
     * The vendor's stopServices() terminates the instance (terminated=true) —
     * always construct a fresh BluetoothMeshService, never reuse.
     */
    fun start(
        nickname: String,
        profileScope: String,
        noisePrivateKeyHex: String,
        signingPrivateKeyHex: String,
        p2pkPubkeyHex: String,
    ) {
        val context = appContext ?: throw BitChatNotStartedException()
        if (!BluetoothStateMonitor.hasPermissions(context)) {
            throw BitChatUnauthorizedException()
        }
        val identity = BitchatIdentityMaterial(noisePrivateKeyHex, signingPrivateKeyHex, p2pkPubkeyHex)
        val suffix = BitchatProfileScope.storageSuffix(profileScope)

        synchronized(lock) {
            if (isRunning && activeScopeSuffix == suffix && activeIdentityID == identity.identityID) {
                if (activeNickname != nickname) {
                    NicknameProvider.currentNickname = nickname
                    activeNickname = nickname
                    mesh?.sendBroadcastAnnounce()
                }
                return
            }
            if (isRunning) {
                stopLocked()
            }

            val scopedContext = ProfileScopedContext(context, suffix)
            BitchatIdentityInstaller.install(scopedContext, identity)
            NicknameProvider.currentNickname = nickname

            isRunning = true
            activeScopeSuffix = suffix
            activeIdentityID = identity.identityID
            activeNickname = nickname
            dmSummaries = loadDmSummaries(context, suffix)

            // The capability beacon TLV must be live before startServices() —
            // the first announce fires during startup and every announce must
            // carry it. v2 is flags-only: no key material on the air.
            EcashAnnounceExtension.localTLV = EcashAnnounceExtension.encodeLocalTLV(
                flags = EcashAnnounceExtension.CAPABILITY_NUT_REQUESTS or
                    EcashAnnounceExtension.CAPABILITY_AUTO_REDEEM,
            )

            // Route inbound Nut Drop vendor Noise payloads (0xA0–0xA3) to JS.
            // Raw bytes only — all Cashu semantics live in JS. Wake lock for
            // the same reason as didReceiveMessage: a payment can arrive with
            // the screen off and JS may need a mint call to redeem it.
            NutPayloadRelay.onInbound = { peerID, typedPayload, timestampMs ->
                holdMessageWakeLock()
                emitter?.invoke(
                    "onNutPayload",
                    mapOf(
                        "peerID" to peerID,
                        "payloadBase64" to android.util.Base64.encodeToString(
                            typedPayload,
                            android.util.Base64.NO_WRAP,
                        ),
                        "timestamp" to timestampMs.toDouble(),
                    ),
                )
            }

            val service = BluetoothMeshService(scopedContext)
            if (service.myPeerID != identity.peerID) {
                // Defensive: would mean the persisted noise key differs from the
                // injected one — the installer must run before construction.
                Log.e(TAG, "peerID mismatch: derived=${service.myPeerID} expected=${identity.peerID}")
            }
            service.encryptionService.onSessionEstablished = { peerID ->
                flushPendingSends(peerID)
            }
            service.delegate = this
            service.startServices()
            mesh = service

            // Pin the process while the mesh runs so background BLE messages
            // still reach JS (Nut Drop auto-redeem). start() is only called
            // from a foregrounded app, so startForegroundService is legal.
            BitchatMeshForegroundService.start(context)
        }
    }

    fun stop() {
        synchronized(lock) { stopLocked() }
    }

    private fun stopLocked() {
        appContext?.let { BitchatMeshForegroundService.stop(it) }
        mesh?.stopServices()
        mesh = null
        isRunning = false
        activeScopeSuffix = null
        activeIdentityID = null
        activeNickname = null
        NicknameProvider.currentNickname = null
        dmSummaries = mutableMapOf()
        pendingSends.clear()
        // Clear capability-beacon state so a profile switch can never reuse
        // the previous profile's announce or surface its peers, and drop the
        // relay handler so stale payloads can't cross profiles.
        EcashAnnounceExtension.localTLV = null
        EcashAnnounceExtension.clear()
        NutPayloadRelay.onInbound = null
    }

    // MARK: - Public mesh messaging

    fun sendMessage(content: String) {
        val service = mesh ?: throw BitChatNotStartedException()
        service.sendMessage(content)
    }

    // MARK: - Private (1:1) messaging over Noise

    fun startPrivateChat(peerIDStr: String) {
        val service = mesh ?: throw BitChatNotStartedException()
        val peerID = validPeerID(peerIDStr)
        when (service.getSessionState(peerID)) {
            is NoiseSession.NoiseSessionState.Established,
            is NoiseSession.NoiseSessionState.Handshaking,
            -> Unit
            else -> service.initiateNoiseHandshake(peerID)
        }
    }

    fun sendPrivateMessage(
        content: String,
        peerIDStr: String,
        @Suppress("UNUSED_PARAMETER") nickname: String,
        messageID: String,
    ): String {
        val service = mesh ?: throw BitChatNotStartedException()
        val peerID = validPeerID(peerIDStr)

        emitDeliveryStatus(messageID, "sending")

        if (service.hasEstablishedSession(peerID)) {
            dispatchPrivateMessage(service, peerID, content, messageID)
        } else {
            synchronized(lock) {
                pendingSends.getOrPut(peerID) { mutableListOf() }
                    .add(PendingSend(content, messageID, System.currentTimeMillis()))
            }
            service.initiateNoiseHandshake(peerID)
            scope.launch {
                delay(HANDSHAKE_TIMEOUT_MS)
                val expired = synchronized(lock) {
                    val queue = pendingSends[peerID] ?: return@synchronized null
                    val entry = queue.firstOrNull { it.messageID == messageID } ?: return@synchronized null
                    queue.remove(entry)
                    if (queue.isEmpty()) pendingSends.remove(peerID)
                    entry
                }
                if (expired != null) {
                    emitDeliveryStatus(expired.messageID, "failed", reason = "handshake-timeout")
                }
            }
        }
        return messageID
    }

    fun resetPrivateChat(peerIDStr: String) {
        val service = mesh ?: throw BitChatNotStartedException()
        val peerID = validPeerID(peerIDStr)
        service.encryptionService.removePeer(peerID)
    }

    /**
     * Send a Nut Drop vendor Noise payload (raw typed bytes, 0xA0–0xA3) to a
     * peer. The native layer is a dumb byte pipe — payload semantics live in
     * JS. Requires an established Noise session (the JS layer calls
     * startBLEPrivateChat first); without one the vendor's encrypt fails and
     * the send is logged + dropped, which the JS solicit timeout absorbs.
     */
    fun sendNutPayload(peerIDStr: String, payloadBase64: String) {
        val service = mesh ?: throw BitChatNotStartedException()
        val peerID = validPeerID(peerIDStr)
        val payload = try {
            android.util.Base64.decode(payloadBase64, android.util.Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            throw BitChatInvalidNutPayloadException()
        }
        if (payload.isEmpty() || !NutPayloadRelay.containsType(payload[0].toInt() and 0xFF)) {
            throw BitChatInvalidNutPayloadException()
        }
        service.sendRawNoisePayload(payload, peerID, "nut payload")
    }

    private fun flushPendingSends(peerID: String) {
        val service = mesh ?: return
        val queue = synchronized(lock) { pendingSends.remove(peerID) } ?: return
        for (pending in queue) {
            dispatchPrivateMessage(service, peerID, pending.content, pending.messageID)
        }
    }

    private fun dispatchPrivateMessage(
        service: BluetoothMeshService,
        peerID: String,
        content: String,
        messageID: String,
    ) {
        // The vendor early-returns on an empty recipientNickname — it only
        // stamps the recipient's display copy, so any non-empty value works.
        val recipientNickname = peerNickname(peerID) ?: peerID
        service.sendPrivateMessage(content, peerID, recipientNickname, messageID)
        emitDeliveryStatus(messageID, "sent")
        recordDmPeer(peerID, peerNickname(peerID), System.currentTimeMillis().toDouble())
    }

    // MARK: - Peers

    fun getPeers(): List<Map<String, Any?>> {
        val service = mesh ?: return emptyList()
        return service.getPeerNicknames().keys.mapNotNull { peerID ->
            val info = service.getPeerInfo(peerID) ?: return@mapNotNull null
            // Capability fields come from the peer's last verified announce
            // beacon (v2 carries flags only — the P2PK lock key now arrives
            // per-send inside the NUT-18 payment request, never on the air).
            val ecashExt = EcashAnnounceExtension.lookup(peerID)
            mapOf(
                "peerID" to info.id,
                "nickname" to info.nickname,
                // Cached announce-time state — can stay true after a silent link
                // drop; hasDirectLink is the real-time hardware mapping check
                // (same source PeerManager.isPeerDirectlyConnected uses).
                "isConnected" to info.isConnected,
                "hasDirectLink" to service.connectionManager.addressPeerMap.containsValue(peerID),
                "lastSeen" to info.lastSeen.toDouble(),
                "supportsNutRequests" to (ecashExt?.supportsNutRequests ?: false),
                "autoRedeem" to (ecashExt?.autoRedeem ?: false),
            )
        }
    }

    private fun peerNickname(peerID: String): String? =
        mesh?.getPeerNicknames()?.get(peerID)?.takeIf { it.isNotBlank() }

    // MARK: - DM peer history (parity with iOS UserDefaults persistence)

    fun getDmHistory(context: Context?, profileScope: String): List<Map<String, Any?>> {
        val suffix = BitchatProfileScope.storageSuffix(profileScope)
        val summaries = synchronized(lock) {
            if (activeScopeSuffix == suffix) {
                dmSummaries.toMap()
            } else {
                val ctx = context ?: appContext ?: return emptyList()
                loadDmSummaries(ctx, suffix)
            }
        }
        return summaries.values
            .sortedByDescending { it.lastTimestamp }
            .map {
                mapOf(
                    "peerID" to it.peerID,
                    "nickname" to (it.nickname ?: ""),
                    "lastTimestamp" to it.lastTimestamp,
                )
            }
    }

    private fun dmPrefs(context: Context, suffix: String) =
        context.getSharedPreferences(
            BitchatProfileScope.scopedPrefsName(suffix, DM_SUMMARIES_PREFS),
            Context.MODE_PRIVATE,
        )

    private fun loadDmSummaries(context: Context, suffix: String): MutableMap<String, DmPeerSummary> {
        val json = dmPrefs(context, suffix).getString(DM_SUMMARIES_KEY, null) ?: return mutableMapOf()
        return try {
            val type = object : TypeToken<MutableMap<String, DmPeerSummary>>() {}.type
            gson.fromJson(json, type) ?: mutableMapOf()
        } catch (_: Exception) {
            mutableMapOf()
        }
    }

    /**
     * Same merge rule as iOS recordDmPeer: keep the longest non-empty nickname
     * seen (announces can replace hex-prefix fallbacks, never the reverse) and
     * the max timestamp.
     */
    private fun recordDmPeer(peerID: String, nickname: String?, timestampMs: Double) {
        val context = appContext ?: return
        val suffix = synchronized(lock) { activeScopeSuffix } ?: return
        val snapshot: Map<String, DmPeerSummary>
        synchronized(lock) {
            val existing = dmSummaries[peerID]
            val nextNickname = when {
                nickname.isNullOrEmpty() -> existing?.nickname
                existing?.nickname.let { it != null && it.isNotEmpty() && it.length > nickname.length } ->
                    existing?.nickname
                else -> nickname
            }
            dmSummaries[peerID] = DmPeerSummary(
                peerID = peerID,
                nickname = nextNickname,
                lastTimestamp = maxOf(existing?.lastTimestamp ?: 0.0, timestampMs),
            )
            snapshot = dmSummaries.toMap()
        }
        scope.launch {
            dmPrefs(context, suffix).edit().putString(DM_SUMMARIES_KEY, gson.toJson(snapshot)).apply()
        }
    }

    // MARK: - Helpers

    private fun validPeerID(peerIDStr: String): String {
        if (!PEER_ID_RE.matches(peerIDStr)) throw BitChatInvalidPeerException()
        return peerIDStr.lowercase()
    }

    private fun emitDeliveryStatus(
        messageID: String,
        status: String,
        nickname: String? = null,
        reason: String? = null,
    ) {
        val payload = mutableMapOf<String, Any?>("messageID" to messageID, "status" to status)
        nickname?.let { payload["nickname"] = it }
        reason?.let { payload["reason"] = it }
        emitter?.invoke("onBLEDeliveryStatus", payload)
    }

    // MARK: - Background execution

    /**
     * Timed PARTIAL_WAKE_LOCK (auto-released) so JS processing + the Nut Drop
     * mint call survive a screen-off BLE message. Timed acquire never leaks —
     * the OS releases it even if the process is killed mid-redeem.
     */
    private fun holdMessageWakeLock() {
        val context = appContext ?: return
        try {
            val powerManager =
                context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            val wakeLock = powerManager.newWakeLock(
                android.os.PowerManager.PARTIAL_WAKE_LOCK,
                "sovran:bitchat-msg",
            )
            wakeLock.setReferenceCounted(false)
            wakeLock.acquire(MESSAGE_WAKE_LOCK_MS)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire message wake lock: ${e.message}")
        }
    }

    // MARK: - BluetoothMeshDelegate (payload shapes mirror the iOS bridge)

    override fun didReceiveMessage(message: BitchatMessage) {
        // BLE callbacks wake the CPU only briefly; a short timed wake lock
        // carries it through JS classification + a possible mint call when
        // the screen is off (auto-released, never held persistently).
        holdMessageWakeLock()
        val senderPeerID = message.senderPeerID ?: ""
        val timestampMs = message.timestamp.time.toDouble()
        if (message.isPrivate) {
            val nickname = message.sender.takeIf { it.isNotBlank() }
                ?: peerNickname(senderPeerID)
                ?: senderPeerID.take(12)
            recordDmPeer(senderPeerID, nickname, timestampMs)
            emitter?.invoke(
                "onBLEPrivateMessage",
                mapOf(
                    "id" to message.id,
                    "peerID" to senderPeerID,
                    "sender" to nickname,
                    "content" to message.content,
                    "timestamp" to timestampMs,
                    "isOwn" to false,
                ),
            )
            // No manual delivery ack — the vendor's MessageHandler already
            // acked before this callback (MessageHandler.sendDeliveryAck).
        } else {
            emitter?.invoke(
                "onBLEMessage",
                mapOf(
                    "id" to message.id,
                    "content" to message.content,
                    "sender" to message.sender,
                    "senderPeerID" to senderPeerID,
                    "timestamp" to timestampMs,
                    "isPrivate" to false,
                ),
            )
        }
    }

    override fun didUpdatePeerList(peers: List<String>) {
        emitter?.invoke("onBLEPeerUpdate", mapOf("type" to "list", "peers" to peers))
    }

    override fun didReceiveDeliveryAck(messageID: String, recipientPeerID: String) {
        emitDeliveryStatus(messageID, "delivered", nickname = peerNickname(recipientPeerID))
    }

    override fun didReceiveReadReceipt(messageID: String, recipientPeerID: String) {
        emitDeliveryStatus(messageID, "read", nickname = peerNickname(recipientPeerID))
    }

    override fun didReceiveChannelLeave(channel: String, fromPeer: String) = Unit

    override fun didReceiveVerifyChallenge(peerID: String, payload: ByteArray, timestampMs: Long) = Unit

    override fun didReceiveVerifyResponse(peerID: String, payload: ByteArray, timestampMs: Long) = Unit

    override fun decryptChannelMessage(encryptedContent: ByteArray, channel: String): String? = null

    override fun getNickname(): String? = activeNickname

    override fun isFavorite(peerID: String): Boolean = false
}
