import Foundation
import ExpoModulesCore
import CoreBluetooth

/// Bridges BitChat's BLEService to the Expo module event system.
/// Manages the lifecycle of the BLE mesh transport and forwards
/// messages/peer updates to JavaScript via events.
///
/// Not `@MainActor` — Expo's `Function` / `OnCreate` callbacks are nonisolated
/// and need to call into us synchronously. BLE delegate callbacks (which run
/// on the BLE queue) hop to the main actor only when touching `module`.
enum BitChatBridgeError: Error, LocalizedError {
    case notStarted
    case invalidPeerID

    var errorDescription: String? {
        switch self {
        case .notStarted:
            return "BLE mesh is not started. Call startBLE() first."
        case .invalidPeerID:
            return "Invalid peer ID (expected 16-char hex)."
        }
    }
}

/// Persisted summary of a 1:1 BLE chat counterparty. Keyed by 16-hex PeerID.
/// Survives app restarts via UserDefaults so the Contacts "Recent" / "All"
/// tabs can surface peers we DM'd in a previous session — upstream
/// PrivateChatManager keeps full history only in-memory.
private struct DmPeerSummary: Codable {
    var peerID: String
    var nickname: String?
    var lastTimestamp: Double  // ms since epoch
}

private let DM_SUMMARIES_DEFAULTS_KEY = "bitchat.dmPeerSummaries"

final class BitChatBLEBridge: NSObject {
    static let shared = BitChatBLEBridge()

    private var bleService: BLEService?
    private var module: BitChatModule?
    private var isRunning = false
    private var activeProfileScope: String?
    private var lastCBState: CBManagerState = .unknown

    /// In-memory mirror of the persisted DM-peer summaries. Mutated only on the
    /// main actor (didReceiveNoisePayload + sendPrivateMessage both hop there
    /// before calling `recordDmPeer`).
    private var dmSummaries: [String: DmPeerSummary] = [:]
    private let dmSummariesQueue = DispatchQueue(label: "bitchat.dmSummaries", qos: .utility)

    private override init() {
        super.init()
    }

    // MARK: - DM peer summary persistence

    private func dmSummariesKey(for scope: String) -> String {
        "\(DM_SUMMARIES_DEFAULTS_KEY).\(scope)"
    }

    private func loadDmSummaries(for scope: String) {
        guard let data = UserDefaults.standard.data(forKey: dmSummariesKey(for: scope)),
              let decoded = try? JSONDecoder().decode([String: DmPeerSummary].self, from: data) else {
            dmSummaries = [:]
            return
        }
        dmSummaries = decoded
    }

    private func loadDmSummariesSnapshot(for scope: String) -> [String: DmPeerSummary] {
        guard let data = UserDefaults.standard.data(forKey: dmSummariesKey(for: scope)),
              let decoded = try? JSONDecoder().decode([String: DmPeerSummary].self, from: data) else {
            return [:]
        }
        return decoded
    }

    private func persistDmSummaries(for scope: String) {
        let snapshot = dmSummaries
        let key = dmSummariesKey(for: scope)
        dmSummariesQueue.async {
            guard let encoded = try? JSONEncoder().encode(snapshot) else { return }
            UserDefaults.standard.set(encoded, forKey: key)
        }
    }

    /// Record a DM exchange with `peerIDStr`. Updates `lastTimestamp` and the
    /// best-known `nickname`, then schedules a UserDefaults write off the main
    /// queue. Called for both inbound (didReceiveNoisePayload) and outbound
    /// (sendPrivateMessage) DMs so the contact appears in Recent/All as soon
    /// as either direction flows.
    @MainActor
    func recordDmPeer(peerID peerIDStr: String, nickname: String?, timestampMs: Double) {
        guard let activeProfileScope else { return }
        let existing = dmSummaries[peerIDStr]
        // Keep the longest non-empty nickname we've seen — incoming events may
        // carry a hex-prefix fallback while a later announce delivers the real
        // nickname. We never want to overwrite a real nickname with a fallback.
        let nextNickname: String?
        if let n = nickname, !n.isEmpty {
            if let prev = existing?.nickname, !prev.isEmpty, prev.count > n.count {
                nextNickname = prev
            } else {
                nextNickname = n
            }
        } else {
            nextNickname = existing?.nickname
        }
        let nextTimestamp = max(existing?.lastTimestamp ?? 0, timestampMs)
        dmSummaries[peerIDStr] = DmPeerSummary(
            peerID: peerIDStr,
            nickname: nextNickname,
            lastTimestamp: nextTimestamp
        )
        persistDmSummaries(for: activeProfileScope)
    }

    /// Returns a snapshot of all known DM-peer summaries, sorted by recency.
    /// Merges any in-memory `PrivateChatManager` peers not yet persisted
    /// (e.g. an inbound message that arrived before our delegate hop).
    func getDmHistory(profileScope: String) -> [[String: Any]] {
        let scope = BitchatProfileScope.storageSuffix(for: profileScope)
        let summaries = activeProfileScope == scope ? dmSummaries : loadDmSummariesSnapshot(for: scope)
        return summaries.values
            .sorted { $0.lastTimestamp > $1.lastTimestamp }
            .map { summary in
                [
                    "peerID": summary.peerID,
                    "nickname": summary.nickname ?? "",
                    "lastTimestamp": summary.lastTimestamp,
                ] as [String: Any]
            }
    }

    func attach(module: BitChatModule) {
        self.module = module
    }

    func start(nickname: String, profileScope: String) {
        let scope = BitchatProfileScope.storageSuffix(for: profileScope)
        if isRunning, activeProfileScope == scope {
            bleService?.setNickname(nickname)
            return
        }
        if isRunning {
            stop()
        }
        isRunning = true
        activeProfileScope = scope
        loadDmSummaries(for: scope)

        let keychain = ProfileScopedBitchatKeychain(profileScope: profileScope)
        let idBridge = NostrIdentityBridge(keychain: keychain)
        let identityManager = SecureIdentityStateManager(keychain)

        let service = BLEService(
            keychain: keychain,
            idBridge: idBridge,
            identityManager: identityManager
        )
        service.delegate = self
        service.setNickname(nickname)
        service.startServices()
        self.bleService = service
    }

    func stop() {
        bleService?.stopServices()
        bleService = nil
        isRunning = false
        activeProfileScope = nil
        dmSummaries = [:]
    }

    func sendMessage(_ content: String) throws {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        service.sendMessage(content, mentions: [])
    }

    // MARK: - Private (1:1) messaging over Noise

    /// Start a private chat with `peerID`. If no Noise session exists yet,
    /// triggers the lazy XX handshake — subsequent `sendPrivateMessage` calls
    /// will flush the pending message once the handshake completes.
    ///
    /// Mirrors upstream ChatViewModel.startPrivateChat:1388 (session gate only).
    ///
    /// The handshake state check + `triggerHandshake` hop off the Expo caller
    /// queue onto a background queue — upstream's `initiateNoiseHandshake`
    /// reaches into `noiseService` and `broadcastPacket`, which expect to run
    /// off the Expo thread. Upstream's public `sendMessage` entrypoint does
    /// the same via its own `messageQueue` hop (BLEService.swift:428).
    func startPrivateChat(_ peerIDStr: String) throws {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        guard let peerIDData = Data(hexString: peerIDStr) else {
            throw BitChatBridgeError.invalidPeerID
        }
        let peerID = PeerID(hexData: peerIDData)
        DispatchQueue.global(qos: .userInitiated).async {
            switch service.getNoiseSessionState(for: peerID) {
            case .none, .failed:
                service.triggerHandshake(with: peerID)
            default:
                break  // .handshakeQueued / .handshaking / .established — nothing to do
            }
        }
    }

    /// Send a Noise-encrypted private message to `peerIDStr`. If the session
    /// isn't established yet, BLEService queues the message and triggers a
    /// handshake automatically (see upstream BLEService.sendPrivateMessage:3174).
    ///
    /// Routed through `BLEService.sendMessage(_:mentions:to:messageID:timestamp:)`
    /// (BLEService.swift:428) instead of the 4-arg `sendPrivateMessage`
    /// overload, because `sendMessage` does an explicit `messageQueue` hop
    /// (`:430-435`) before dispatching to the private `sendPrivateMessage(_:to:messageID:)`
    /// that expects to run on that queue (comment at `:3314`). Calling the
    /// 4-arg overload from an Expo AsyncFunction would execute Noise encrypt
    /// and pending-message bookkeeping on the wrong queue, silently dropping
    /// the send on a `collectionsQueue.sync(flags:.barrier)` race.
    /// Send a Noise-encrypted DM. `messageID` is supplied by the JS caller so
    /// the optimistic chat bubble and the later `onBLEDeliveryStatus` events
    /// (sent / delivered / failed) can be correlated on a single key. Returns
    /// the messageID for symmetry with the JS contract.
    @discardableResult
    func sendPrivateMessage(
        _ content: String,
        to peerIDStr: String,
        nickname: String,
        messageID: String
    ) throws -> String {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        guard let peerIDData = Data(hexString: peerIDStr) else {
            throw BitChatBridgeError.invalidPeerID
        }
        let peerID = PeerID(hexData: peerIDData)
        _ = nickname  // recipient-stamp nickname is unused by the BLE-direct path
        service.sendMessage(content, mentions: [], to: peerID, messageID: messageID, timestamp: nil)
        // Stamp this peer into our persisted DM history so the Contacts tab's
        // Recent/All lists surface them after a restart. Look up the best
        // known nickname from current peer snapshots; falls back to nil.
        let stampNickname = service.currentPeerSnapshots()
            .first(where: { $0.peerID == peerID })?.nickname
        let now = Date().timeIntervalSince1970 * 1000
        Task { @MainActor in
            BitChatBLEBridge.shared.recordDmPeer(
                peerID: peerIDStr,
                nickname: stampNickname,
                timestampMs: now
            )
        }
        return messageID
    }

    /// Clear the Noise session for `peerIDStr` so the next outbound DM
    /// triggers a fresh XX handshake. Used by the JS-side watchdog after an
    /// outbound message has been `sending` for too long — likely a stuck
    /// handshake or invalidated session keys. Does NOT drain upstream's
    /// `pendingMessagesAfterHandshake[peerID]`; those messages remain queued
    /// and will flush once the new handshake completes. The JS store marks
    /// them `failed` so the user isn't blocked waiting on them.
    func resetPrivateChat(_ peerIDStr: String) throws {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        guard let peerIDData = Data(hexString: peerIDStr) else {
            throw BitChatBridgeError.invalidPeerID
        }
        let peerID = PeerID(hexData: peerIDData)
        service.getNoiseService().clearSession(for: peerID)
    }

    func getPeers() -> [[String: Any]] {
        guard let service = bleService else { return [] }
        return service.currentPeerSnapshots().map { peer in
            // `isConnected` is the cached announce-time state — stays true if
            // the BLE link silently dies. `hasDirectLink` is the real-time
            // peripheral/central check — the only state that determines
            // whether `sendEncrypted` can deliver a DM without bouncing
            // through the mesh-flood + 15s spool fallback. Surface both so
            // UI can warn users when "connected" doesn't mean reachable.
            let link = service.linkState(for: peer.peerID)
            return [
                "peerID": peer.peerID.id,
                "nickname": peer.nickname,
                "isConnected": peer.isConnected,
                "hasDirectLink": link.hasPeripheral || link.hasCentral,
                "lastSeen": peer.lastSeen.timeIntervalSince1970 * 1000,
            ] as [String: Any]
        }
    }

    var bluetoothState: String {
        switch lastCBState {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .resetting, .unknown: return "unknown"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - BitchatDelegate

extension BitChatBLEBridge: BitchatDelegate {
    nonisolated func didReceiveMessage(_ message: BitchatMessage) {
        Task { @MainActor in
            module?.sendEvent("onBLEMessage", [
                "id": message.id,
                "content": message.content,
                "sender": message.sender,
                "senderPeerID": message.senderPeerID?.id ?? "",
                "timestamp": message.timestamp.timeIntervalSince1970 * 1000,
                "isPrivate": message.isPrivate,
            ])
        }
    }

    nonisolated func didReceivePublicMessage(from peerID: PeerID, nickname: String, content: String, timestamp: Date, messageID: String?) {
        Task { @MainActor in
            module?.sendEvent("onBLEMessage", [
                "id": messageID ?? UUID().uuidString,
                "content": content,
                "sender": nickname,
                "senderPeerID": peerID.id,
                "timestamp": timestamp.timeIntervalSince1970 * 1000,
                "isPrivate": false,
            ])
        }
    }

    nonisolated func didConnectToPeer(_ peerID: PeerID) {
        Task { @MainActor in
            module?.sendEvent("onBLEPeerUpdate", ["type": "connected", "peerID": peerID.id])
        }
    }

    nonisolated func didDisconnectFromPeer(_ peerID: PeerID) {
        Task { @MainActor in
            module?.sendEvent("onBLEPeerUpdate", ["type": "disconnected", "peerID": peerID.id])
        }
    }

    nonisolated func didUpdatePeerList(_ peers: [PeerID]) {
        Task { @MainActor in
            module?.sendEvent("onBLEPeerUpdate", [
                "type": "list",
                "peers": peers.map { $0.id },
            ])
        }
    }

    nonisolated func isFavorite(fingerprint: String) -> Bool { false }

    nonisolated func didUpdateMessageDeliveryStatus(_ messageID: String, status: DeliveryStatus) {
        // Map the vendored enum to a stable string so JS can render delivery
        // states (sending → sent → delivered → failed). Without this hook the
        // JS hook's optimistic message stayed "pending" forever — the user
        // never saw send confirmation or failure, and pending-after-handshake
        // queue drops were silent.
        let statusStr: String
        var reason: String? = nil
        var nickname: String? = nil
        switch status {
        case .sending:
            statusStr = "sending"
        case .sent:
            statusStr = "sent"
        case .delivered(let to, _):
            statusStr = "delivered"
            nickname = to
        case .read(let by, _):
            statusStr = "read"
            nickname = by
        case .failed(let r):
            statusStr = "failed"
            reason = r
        case .partiallyDelivered(let reached, let total):
            statusStr = "partiallyDelivered"
            reason = "\(reached)/\(total)"
        }
        Task { @MainActor in
            var payload: [String: Any] = [
                "messageID": messageID,
                "status": statusStr,
            ]
            if let nickname { payload["nickname"] = nickname }
            if let reason { payload["reason"] = reason }
            module?.sendEvent("onBLEDeliveryStatus", payload)
        }
    }

    /// Decode + dispatch Noise-encrypted payloads targeted at us. The outer
    /// BLEService has already unwrapped the Noise tunnel; we only see the
    /// decrypted payload + `NoisePayloadType` tag. For `.privateMessage` we
    /// decode the TLV and emit `onBLEPrivateMessage` with the sender peerID,
    /// nickname (looked up via BLEService peer snapshots), message id, body,
    /// and timestamp.
    nonisolated func didReceiveNoisePayload(from peerID: PeerID, type: NoisePayloadType, payload: Data, timestamp: Date) {
        guard type == .privateMessage,
              let pm = PrivateMessagePacket.decode(from: payload) else {
            return
        }
        Task { @MainActor in
            let senderNickname = BitChatBLEBridge.shared.bleService?
                .currentPeerSnapshots()
                .first(where: { $0.peerID == peerID })?
                .nickname ?? String(peerID.id.prefix(12))
            let timestampMs = timestamp.timeIntervalSince1970 * 1000
            BitChatBLEBridge.shared.recordDmPeer(
                peerID: peerID.id,
                nickname: senderNickname,
                timestampMs: timestampMs
            )
            BitChatBLEBridge.shared.module?.sendEvent("onBLEPrivateMessage", [
                "id": pm.messageID,
                "peerID": peerID.id,
                "sender": senderNickname,
                "content": pm.content,
                "timestamp": timestampMs,
                "isOwn": false,
            ])
            // UX parity with upstream ChatViewModel:3079 — ack the message so
            // the sender's UI can flip .sending → .delivered. Hop off the
            // MainActor so BLEService's internals run on a background queue.
            if let service = BitChatBLEBridge.shared.bleService {
                let messageID = pm.messageID
                DispatchQueue.global(qos: .utility).async {
                    service.sendDeliveryAck(for: messageID, to: peerID)
                }
            }
        }
    }

    nonisolated func didUpdateBluetoothState(_ state: CBManagerState) {
        Task { @MainActor in
            BitChatBLEBridge.shared.lastCBState = state
            let stateStr: String
            switch state {
            case .poweredOn: stateStr = "poweredOn"
            case .poweredOff: stateStr = "poweredOff"
            case .unauthorized: stateStr = "unauthorized"
            case .unsupported: stateStr = "unsupported"
            default: stateStr = "unknown"
            }
            module?.sendEvent("onBLEStateChanged", ["state": stateStr])
        }
    }
}
