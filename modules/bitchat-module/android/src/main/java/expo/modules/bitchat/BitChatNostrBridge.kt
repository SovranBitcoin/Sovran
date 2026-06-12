package expo.modules.bitchat

import android.app.Application
import android.content.Context
import android.util.Base64
import com.bitchat.android.model.NoisePayloadType
import com.bitchat.android.model.PrivateMessagePacket
import com.bitchat.android.nostr.NostrEmbeddedBitChat
import com.bitchat.android.nostr.NostrEvent
import com.bitchat.android.nostr.NostrFilter
import com.bitchat.android.nostr.NostrIdentity
import com.bitchat.android.nostr.NostrIdentityBridge
import com.bitchat.android.nostr.NostrKind
import com.bitchat.android.nostr.NostrProtocol
import com.bitchat.android.nostr.NostrRelayManager
import com.bitchat.android.nostr.RelayDirectory
import com.bitchat.android.protocol.BitchatPacket
import com.bitchat.android.protocol.MessageType
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class BitChatNostrNotStartedException :
    Exception("Nostr stack is not started. Call startNostr() first.")

class BitChatNoActiveGeohashException :
    Exception("No active geohash. Call joinGeohash() first.")

class BitChatCannotDMSelfException : Exception("Cannot DM your own geohash identity.")

class BitChatEmbedFailedException : Exception("Failed to encode private message packet.")

/**
 * Bridges the vendored bitchat-android Nostr stack (NostrRelayManager,
 * RelayDirectory, NostrIdentityBridge, NostrProtocol) to the Expo module
 * event system — the Kotlin counterpart of ios/BitChatNostrBridge.swift with
 * identical event names and payload shapes.
 *
 * Simpler than iOS: the Android NostrRelayManager has geohash relay routing
 * built in (subscribeForGeohash / sendEventToGeohash + RelayDirectory), so no
 * dependency-injection dance is needed. The Tor-aware OkHttpProvider is
 * replaced by a plain stub (com.bitchat.android.net.OkHttpProvider in this
 * module's sources).
 *
 * Constants mirror upstream iOS TransportConfig: 1h public lookback /
 * limit 200, 24h gift-wrap lookback, 5 geohash relays.
 */
object BitChatNostrBridge {

    private const val PUBLIC_LOOKBACK_MS = 3_600_000L
    private const val PUBLIC_INITIAL_LIMIT = 200
    private const val DM_LOOKBACK_MS = 86_400_000L
    private const val GIFT_WRAP_SEEN_CAP = 2000
    private const val GIFT_WRAP_SEEN_KEEP = 1000

    var emitter: ((name: String, body: Map<String, Any?>) -> Unit)? = null

    private var appContext: Context? = null
    private var scopedContext: Context? = null
    private var activeScopeSuffix: String? = null
    private var isStarted = false
    private var currentGeohash: String? = null
    private var currentIdentity: NostrIdentity? = null
    private val seenGiftWrapIDs = LinkedHashSet<String>()
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    fun attach(context: Context, emit: (String, Map<String, Any?>) -> Unit) {
        appContext = context.applicationContext
        emitter = emit
    }

    fun detach() {
        stop()
        emitter = null
        appContext = null
    }

    fun start(profileScope: String) {
        val context = appContext ?: throw BitChatNostrNotStartedException()
        val suffix = BitchatProfileScope.storageSuffix(profileScope)
        if (isStarted && activeScopeSuffix == suffix) return
        if (isStarted) stop()

        (context.applicationContext as? Application)?.let { RelayDirectory.initialize(it) }
        // Per-profile device seed: NostrIdentityBridge reads/writes
        // `nostr_device_seed` through SecureIdentityStateManager(context), so a
        // scoped context isolates it per profile — same as the iOS
        // ProfileScopedBitchatKeychain. NOTE: NostrIdentityBridge keeps a
        // process-wide geohash→identity cache; Sovran profile switching is
        // restart-based, which keeps that cache scope-consistent.
        scopedContext = ProfileScopedContext(context, suffix)
        activeScopeSuffix = suffix
        isStarted = true
    }

    fun stop() {
        leaveGeohash()
        if (isStarted) {
            NostrRelayManager.shared.disconnect()
        }
        isStarted = false
        activeScopeSuffix = null
        scopedContext = null
    }

    // MARK: - Geohash channel

    fun joinGeohash(geohash: String) {
        if (!isStarted) throw BitChatNostrNotStartedException()
        val context = scopedContext ?: throw BitChatNostrNotStartedException()
        val relayManager = NostrRelayManager.shared

        currentGeohash?.let { previous ->
            relayManager.unsubscribe("geo-$previous")
            relayManager.unsubscribe("geo-dm-$previous")
        }

        val identity = NostrIdentityBridge.deriveIdentity(geohash, context)
        currentGeohash = geohash
        currentIdentity = identity

        val now = System.currentTimeMillis()
        relayManager.subscribeForGeohash(
            geohash = geohash,
            filter = NostrFilter.geohashEphemeral(
                geohash,
                since = now - PUBLIC_LOOKBACK_MS,
                limit = PUBLIC_INITIAL_LIMIT,
            ),
            id = "geo-$geohash",
            handler = { event -> emitPublicEvent(event, geohash) },
        )
        relayManager.subscribeForGeohash(
            geohash = geohash,
            filter = NostrFilter.giftWrapsFor(identity.publicKeyHex, since = now - DM_LOOKBACK_MS),
            id = "geo-dm-$geohash",
            handler = { giftWrap -> handleGiftWrap(giftWrap, geohash) },
        )
    }

    fun leaveGeohash() {
        val geohash = currentGeohash ?: return
        NostrRelayManager.shared.unsubscribe("geo-$geohash")
        NostrRelayManager.shared.unsubscribe("geo-dm-$geohash")
        currentGeohash = null
        currentIdentity = null
        synchronized(seenGiftWrapIDs) { seenGiftWrapIDs.clear() }
    }

    // MARK: - Send

    fun sendMessage(content: String, nickname: String?) {
        if (!isStarted) throw BitChatNostrNotStartedException()
        val geohash = currentGeohash ?: throw BitChatNoActiveGeohashException()
        val identity = currentIdentity ?: throw BitChatNoActiveGeohashException()
        // createEphemeralGeohashEvent is suspend (PoW mining support — Sovran
        // ships with PoW disabled, the default). Fire-and-forget like the iOS
        // bridge: the relay manager queues the actual socket write either way.
        scope.launch {
            val event = NostrProtocol.createEphemeralGeohashEvent(
                content = content,
                geohash = geohash,
                senderIdentity = identity,
                nickname = nickname?.takeIf { it.isNotEmpty() },
            )
            NostrRelayManager.shared.sendEventToGeohash(event, geohash)
        }
    }

    /**
     * NIP-17 gift-wrapped DM to another participant of the current geohash,
     * addressed by the per-geohash hex pubkey seen on their public messages.
     * The embedded `bitchat1:` BitchatPacket keeps cross-client interop with
     * upstream bitchat. Mirrors ios/BitChatNostrBridge.sendPrivateMessage.
     */
    fun sendPrivateMessage(recipientPubkey: String, content: String) {
        if (!isStarted) throw BitChatNostrNotStartedException()
        val geohash = currentGeohash ?: throw BitChatNoActiveGeohashException()
        val identity = currentIdentity ?: throw BitChatNoActiveGeohashException()
        if (recipientPubkey.equals(identity.publicKeyHex, ignoreCase = true)) {
            throw BitChatCannotDMSelfException()
        }

        val messageID = UUID.randomUUID().toString()
        // No mesh-side peerID for geohash-only users — empty senderID, same as
        // iOS. The authoritative identity is the gift wrap's outer signature.
        val embedded = NostrEmbeddedBitChat.encodePMForNostrNoRecipient(
            content = content,
            messageID = messageID,
            senderPeerID = "",
        ) ?: throw BitChatEmbedFailedException()

        val giftWraps = NostrProtocol.createPrivateMessage(
            content = embedded,
            recipientPubkey = recipientPubkey,
            senderIdentity = identity,
        )
        for (wrap in giftWraps) {
            NostrRelayManager.shared.sendEventToGeohash(wrap, geohash)
        }
    }

    // MARK: - Inbound

    private fun emitPublicEvent(event: NostrEvent, geohash: String) {
        // The geohash filter also matches kind-20001 presence heartbeats; only
        // kind 20000 is chat (same split as the vendor's GeohashMessageHandler).
        if (event.kind != NostrKind.EPHEMERAL_EVENT) return
        val nickname = event.tags.firstOrNull { it.size >= 2 && it[0] == "n" }?.get(1)
        emitter?.invoke(
            "onNostrMessage",
            mapOf(
                "id" to event.id,
                "content" to event.content,
                "sender" to (nickname ?: event.pubkey.take(12)),
                "senderPubkey" to event.pubkey,
                "timestamp" to event.createdAt.toDouble() * 1000,
                "geohash" to geohash,
                "isOwn" to event.pubkey.equals(currentIdentity?.publicKeyHex, ignoreCase = true),
            ),
        )
    }

    private fun handleGiftWrap(giftWrap: NostrEvent, geohash: String) {
        synchronized(seenGiftWrapIDs) {
            if (!seenGiftWrapIDs.add(giftWrap.id)) return
            if (seenGiftWrapIDs.size > GIFT_WRAP_SEEN_CAP) {
                val keep = seenGiftWrapIDs.toList().takeLast(GIFT_WRAP_SEEN_KEEP)
                seenGiftWrapIDs.clear()
                seenGiftWrapIDs.addAll(keep)
            }
        }
        val identity = currentIdentity ?: return
        if (geohash != currentGeohash) return

        // NIP-17 double unwrap (gift wrap → seal → rumor); not-for-us or
        // malformed wraps return null and are swallowed.
        val (content, senderPubkey, timestampSeconds) =
            NostrProtocol.decryptPrivateMessage(giftWrap, identity) ?: return

        if (!content.startsWith("bitchat1:")) return
        val packetData = base64URLDecode(content.removePrefix("bitchat1:")) ?: return
        val packet = BitchatPacket.fromBinaryData(packetData) ?: return
        if (packet.type != MessageType.NOISE_ENCRYPTED.value) return

        // Inner payload format: [1-byte NoisePayloadType][TLV].
        val payload = packet.payload
        if (payload.isEmpty()) return
        if (NoisePayloadType.fromValue(payload[0].toUByte()) != NoisePayloadType.PRIVATE_MESSAGE) return
        val pm = PrivateMessagePacket.decode(payload.copyOfRange(1, payload.size)) ?: return

        emitter?.invoke(
            "onNostrPrivateMessage",
            mapOf(
                "id" to pm.messageID,
                "senderPubkey" to senderPubkey,
                "sender" to senderPubkey.take(12),
                "content" to pm.content,
                "timestamp" to timestampSeconds.toDouble() * 1000,
                "geohash" to geohash,
                "isOwn" to false,
            ),
        )
    }

    /** base64url (`-_`, unpadded) → bytes; same transform as the iOS bridge. */
    private fun base64URLDecode(encoded: String): ByteArray? = try {
        Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    } catch (_: Exception) {
        null
    }
}
