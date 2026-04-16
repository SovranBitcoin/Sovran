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
    private var currentGeohashRelays: [String] = []
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
        }

        let identity = try identityBridge.deriveIdentity(forGeohash: geohash)
        currentGeohash = geohash
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
    }

    func leaveGeohash() {
        guard let geohash = currentGeohash else { return }
        relayManager?.unsubscribe(id: "geo-\(geohash)")
        currentGeohash = nil
        currentGeohashPubkey = nil
        currentGeohashRelays = []
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

    // MARK: - Closest-relay query (for JS / diagnostics)

    func closestRelays(toLat lat: Double, lon: Double, count: Int) -> [String] {
        GeoRelayDirectory.shared.closestRelays(toLat: lat, lon: lon, count: count)
    }

    func closestRelays(toGeohash geohash: String, count: Int) -> [String] {
        GeoRelayDirectory.shared.closestRelays(toGeohash: geohash, count: count)
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

    var errorDescription: String? {
        switch self {
        case .notStarted: return "Nostr stack is not started. Call startNostr() first."
        case .noActiveGeohash: return "No active geohash. Call joinGeohash() first."
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
