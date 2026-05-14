import Foundation
import Combine
import ExpoModulesCore

/// Bridges BitChat's Nostr stack (NostrRelayManager, GeoRelayDirectory,
/// NostrIdentityBridge, NostrProtocol) to the Expo module event system.
///
/// Nostr used to live in JS (`features/bitchat/lib/BitChatService.ts`) with a
/// hardcoded relay list and the user's main Nostr pubkey signing every event.
/// This bridge gives us upstream's geohash-scoped relay selection (5 closest
/// via Haversine from a 304-entry CSV) and per-geohash identity derivation
/// (HMAC-SHA256 of device seed + geohash) for free.
///
/// `@MainActor` because upstream's NostrRelayManager and GeoRelayDirectory
/// are both `@MainActor`-isolated.
@MainActor
final class BitChatNostrBridge {
    static let shared = BitChatNostrBridge()

    private weak var module: BitChatModule?
    private let identityBridge = NostrIdentityBridge()
    private var relayManager: NostrRelayManager?
    private var currentGeohash: String?
    private var currentGeohashPubkey: String?
    /// Cached so we can decrypt inbound gift wraps without re-deriving on
    /// every event. Kept in sync with `currentGeohash` via joinGeohash /
    /// leaveGeohash.
    private var currentGeohashIdentity: NostrIdentity?
    private var currentGeohashRelays: [String] = []
    /// Dedup set for gift-wrap event IDs — NostrRelayManager may replay the
    /// same wrap from multiple relays.
    private var seenGiftWrapIDs = Set<String>()
    private var isStarted = false

    private init() {}

    /// Called from `OnCreate` (nonisolated). Hops to MainActor to store the
    /// weak module reference, so the rest of the class can stay MainActor-isolated.
    nonisolated func attach(module: BitChatModule) {
        Task { @MainActor in
            BitChatNostrBridge.shared.module = module
        }
    }

    // MARK: - Lifecycle

    func start() {
        guard !isStarted else { return }
        isStarted = true

        // NostrRelayManager.live() would pull in NetworkActivationService /
        // FavoritesPersistenceService / LocationChannelManager / TorManager —
        // none of which make sense for this app. Inject a minimal deps struct
        // that short-circuits every gate and uses a direct URLSession for WSS.
        let deps = NostrRelayManagerDependencies(
            activationAllowed: { true },
            userTorEnabled: { false },
            hasMutualFavorites: { false },
            // Report "authorized" so NostrRelayManager's default-relay policy
            // (hasMutualFavorites || hasLocationPermission) lets us use the
            // default relay pool for non-geohash traffic if it ever comes up.
            hasLocationPermission: { true },
            mutualFavoritesPublisher: Empty<Set<Data>, Never>(completeImmediately: false).eraseToAnyPublisher(),
            locationPermissionPublisher: Empty<LocationChannelManager.PermissionState, Never>(completeImmediately: false).eraseToAnyPublisher(),
            torEnforced: { false },
            torIsReady: { false },
            torIsForeground: { true },
            awaitTorReady: { completion in completion(false) },
            makeSession: { BridgeURLSessionAdapter(base: URLSession.shared) },
            scheduleAfter: { delay, action in
                DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: action)
            },
            now: Date.init
        )

        relayManager = NostrRelayManager(dependencies: deps)

        // GeoRelayDirectory.shared auto-inits via .live() and calls
        // loadLocalEntries() at init, which reads the bundled
        // online_relays_gps.csv (304 entries). Its remote refresh calls
        // TorManager.shared.awaitReady() which is stubbed to return false,
        // so the remote path silently no-ops — we just use the bundled CSV.
        _ = GeoRelayDirectory.shared
    }

    func stop() {
        leaveGeohash()
        relayManager?.disconnect()
        relayManager = nil
        isStarted = false
    }

    // MARK: - Geohash channel

    func joinGeohash(_ geohash: String) throws {
        guard isStarted, let relayManager else {
            throw BitChatNostrBridgeError.notStarted
        }

        // Unsubscribe any previous geohash subscription. Leave WebSockets warm.
        if let previous = currentGeohash {
            relayManager.unsubscribe(id: "geo-\(previous)")
            relayManager.unsubscribe(id: "geo-dm-\(previous)")
        }

        let identity = try identityBridge.deriveIdentity(forGeohash: geohash)
        currentGeohash = geohash
        currentGeohashIdentity = identity
        currentGeohashPubkey = identity.publicKeyHex
        currentGeohashRelays = GeoRelayDirectory.shared.closestRelays(
            toGeohash: geohash,
            count: TransportConfig.nostrGeoRelayCount
        )

        let since = Date().addingTimeInterval(-TransportConfig.nostrGeohashInitialLookbackSeconds)
        let filter = NostrFilter.geohashEphemeral(
            geohash,
            since: since,
            limit: TransportConfig.nostrGeohashInitialLimit
        )

        relayManager.subscribe(
            filter: filter,
            id: "geo-\(geohash)",
            relayUrls: currentGeohashRelays,
            handler: { [weak self] event in
                // Runs on MainActor (NostrRelayManager is @MainActor).
                self?.emit(event: event, forGeohash: geohash)
            },
            onEOSE: nil
        )

        // Subscribe to NIP-17 gift wraps (kind 1059) addressed to our
        // per-geohash pubkey. Upstream uses a 24h lookback for DMs; match that.
        let dmSince = Date().addingTimeInterval(-TransportConfig.nostrDMSubscribeLookbackSeconds)
        let dmFilter = NostrFilter.giftWrapsFor(pubkey: identity.publicKeyHex, since: dmSince)
        relayManager.subscribe(
            filter: dmFilter,
            id: "geo-dm-\(geohash)",
            relayUrls: currentGeohashRelays,
            handler: { [weak self] giftWrap in
                self?.handleGiftWrap(giftWrap, forGeohash: geohash)
            },
            onEOSE: nil
        )
    }

    func leaveGeohash() {
        guard let geohash = currentGeohash else { return }
        relayManager?.unsubscribe(id: "geo-\(geohash)")
        relayManager?.unsubscribe(id: "geo-dm-\(geohash)")
        currentGeohash = nil
        currentGeohashPubkey = nil
        currentGeohashIdentity = nil
        currentGeohashRelays = []
        seenGiftWrapIDs.removeAll()
    }

    // MARK: - Send

    func sendMessage(_ content: String, nickname: String?) throws {
        guard let relayManager else {
            throw BitChatNostrBridgeError.notStarted
        }
        guard let geohash = currentGeohash else {
            throw BitChatNostrBridgeError.noActiveGeohash
        }

        let identity = try identityBridge.deriveIdentity(forGeohash: geohash)
        let event = try NostrProtocol.createEphemeralGeohashEvent(
            content: content,
            geohash: geohash,
            senderIdentity: identity,
            nickname: nickname,
            teleported: false
        )
        relayManager.sendEvent(event, to: currentGeohashRelays)
    }

    // MARK: - Private (1:1) geohash DMs (NIP-17 gift wrap)

    /// Send an encrypted DM to another geohash participant addressed by their
    /// Nostr hex pubkey (the per-geohash-derived pubkey we saw on an inbound
    /// public event's `senderPubkey` field). Mirrors upstream
    /// NostrTransport.sendPrivateMessageGeohash:235.
    ///
    /// Embeds a `BitchatPacket(privateMessage)` in a `bitchat1:`-prefixed
    /// base64url string (so cross-client interop with upstream bitchat works),
    /// then wraps that string in a NIP-17 gift wrap (kind 1059) sent to the
    /// same geohash-closest relay set we use for public messages.
    func sendPrivateMessage(to recipientHex: String, content: String) throws {
        guard let relayManager else {
            throw BitChatNostrBridgeError.notStarted
        }
        guard let identity = currentGeohashIdentity else {
            throw BitChatNostrBridgeError.noActiveGeohash
        }
        // Don't let the user DM themselves — upstream bails silently; we bail
        // loudly so the JS caller can show a meaningful error.
        if recipientHex.lowercased() == identity.publicKeyHex.lowercased() {
            throw BitChatNostrBridgeError.cannotDMSelf
        }

        let messageID = UUID().uuidString
        // We don't have a mesh-side myPeerID for geohash-only users, so stamp
        // the embedded BitchatPacket with an empty senderID. The authoritative
        // identity on the wire is the gift-wrap's outer Nostr signature.
        let senderPeerID = PeerID(str: "")

        guard let embedded = NostrEmbeddedBitChat.encodePMForNostrNoRecipient(
            content: content,
            messageID: messageID,
            senderPeerID: senderPeerID
        ) else {
            throw BitChatNostrBridgeError.embedFailed
        }

        let giftWrap = try NostrProtocol.createPrivateMessage(
            content: embedded,
            recipientPubkey: recipientHex,
            senderIdentity: identity
        )
        // Send on the same 5-relay geohash set as public messages. Keeps the
        // DM reachable wherever the recipient is subscribed.
        relayManager.sendEvent(giftWrap, to: currentGeohashRelays)
    }

    /// Gift-wrap inbound handler. Unwraps (NIP-17 decrypt) → parses the
    /// `bitchat1:` base64url-encoded BitchatPacket → decodes the inner TLV
    /// PrivateMessagePacket → emits `onNostrPrivateMessage` to JS.
    private func handleGiftWrap(_ giftWrap: NostrEvent, forGeohash geohash: String) {
        // Dedup — the subscription's multiple relays may each replay the
        // same wrap. Cap the set so long-running channels don't grow
        // unbounded; upstream uses a similar MessageDeduplicationService.
        guard !seenGiftWrapIDs.contains(giftWrap.id) else { return }
        seenGiftWrapIDs.insert(giftWrap.id)
        if seenGiftWrapIDs.count > 2000 {
            // Cheap trim — drop the oldest half.
            let kept = Array(seenGiftWrapIDs).suffix(1000)
            seenGiftWrapIDs = Set(kept)
        }

        guard let identity = currentGeohashIdentity,
              geohash == currentGeohash else { return }

        // NIP-17 double unwrap (gift wrap → seal → rumor).
        let decrypted: (content: String, senderPubkey: String, timestamp: Int)
        do {
            decrypted = try NostrProtocol.decryptPrivateMessage(
                giftWrap: giftWrap,
                recipientIdentity: identity
            )
        } catch {
            // Not addressed to us, or malformed — swallow.
            return
        }

        // The rumor's `content` is the bitchat1: base64url-encoded BitchatPacket.
        // Upstream's `NostrProtocol.base64URLDecode` is fileprivate so we
        // inline the equivalent 5-line transform here.
        guard decrypted.content.hasPrefix("bitchat1:") else { return }
        let encoded = String(decrypted.content.dropFirst("bitchat1:".count))
        guard let packetData = Self.base64URLDecode(encoded),
              let packet = BitchatPacket.from(packetData),
              packet.type == MessageType.noiseEncrypted.rawValue else {
            return
        }

        // Upstream's inner payload format: [1-byte NoisePayloadType][TLV].
        guard packet.payload.count >= 1,
              let payloadType = NoisePayloadType(rawValue: packet.payload[0]),
              payloadType == .privateMessage else {
            return
        }
        let tlv = packet.payload.subdata(in: 1..<packet.payload.count)
        guard let pm = PrivateMessagePacket.decode(from: tlv) else { return }

        module?.sendEvent("onNostrPrivateMessage", [
            "id": pm.messageID,
            "senderPubkey": decrypted.senderPubkey,
            "sender": String(decrypted.senderPubkey.prefix(12)),
            "content": pm.content,
            // NostrProtocol.decryptPrivateMessage returns the rumor timestamp
            // in Nostr seconds — convert to ms for JS consumers.
            "timestamp": Double(decrypted.timestamp) * 1000,
            "geohash": geohash,
            "isOwn": false,
        ])
    }

    // MARK: - Helpers

    /// Local copy of upstream's `NostrProtocol.base64URLDecode` (which is
    /// fileprivate so we can't call it directly from this module).
    /// Reverses base64url (`-_` alphabet, no padding) → standard base64 →
    /// bytes. Keeps the same byte output as upstream so inbound gift wraps
    /// from either client decode identically.
    private static func base64URLDecode(_ s: String) -> Data? {
        var str = s
        let pad = (4 - (str.count % 4)) % 4
        if pad > 0 { str += String(repeating: "=", count: pad) }
        str = str.replacingOccurrences(of: "-", with: "+")
                 .replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: str)
    }

    // MARK: - Event dispatch

    private func emit(event: NostrEvent, forGeohash geohash: String) {
        // Extract #n (nickname) tag; fall back to short pubkey if absent.
        var nickname: String?
        for tag in event.tags where tag.count >= 2 {
            if tag[0] == "n" {
                nickname = tag[1]
                break
            }
        }
        let sender = nickname ?? String(event.pubkey.prefix(12))

        let payload: [String: Any] = [
            "id": event.id,
            "content": event.content,
            "sender": sender,
            "senderPubkey": event.pubkey,
            "timestamp": Double(event.created_at) * 1000,
            "geohash": geohash,
            "isOwn": event.pubkey == currentGeohashPubkey,
        ]
        module?.sendEvent("onNostrMessage", payload)
    }
}

// MARK: - Errors

enum BitChatNostrBridgeError: Error, LocalizedError {
    case notStarted
    case noActiveGeohash
    case cannotDMSelf
    case embedFailed

    var errorDescription: String? {
        switch self {
        case .notStarted: return "Nostr stack is not started. Call startNostr() first."
        case .noActiveGeohash: return "No active geohash. Call joinGeohash() first."
        case .cannotDMSelf: return "Cannot DM your own geohash identity."
        case .embedFailed: return "Failed to encode private message packet."
        }
    }
}

// MARK: - URLSession adapter for NostrRelayManager dependency injection

// Upstream's URLSessionAdapter / URLSessionWebSocketTaskAdapter are `private`
// to NostrRelayManager.swift, so we re-implement the same thin shape here.
private final class BridgeURLSessionWebSocketTaskAdapter: NostrRelayConnectionProtocol {
    private let base: URLSessionWebSocketTask

    init(base: URLSessionWebSocketTask) {
        self.base = base
    }

    func resume() {
        base.resume()
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        base.cancel(with: closeCode, reason: reason)
    }

    func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping (Error?) -> Void) {
        base.send(message, completionHandler: completionHandler)
    }

    func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
        base.receive(completionHandler: completionHandler)
    }

    func sendPing(pongReceiveHandler: @escaping (Error?) -> Void) {
        base.sendPing(pongReceiveHandler: pongReceiveHandler)
    }
}

private struct BridgeURLSessionAdapter: NostrRelaySessionProtocol {
    let base: URLSession

    func webSocketTask(with url: URL) -> NostrRelayConnectionProtocol {
        BridgeURLSessionWebSocketTaskAdapter(base: base.webSocketTask(with: url))
    }
}
