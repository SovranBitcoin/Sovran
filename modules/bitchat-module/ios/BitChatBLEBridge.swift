import Foundation
import ExpoModulesCore
import CoreBluetooth
import CryptoKit
import UIKit

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
    case invalidIdentityMaterial(String)
    case identityKeySaveFailed(String)

    var errorDescription: String? {
        switch self {
        case .notStarted:
            return "BLE mesh is not started. Call startBLE() first."
        case .invalidPeerID:
            return "Invalid peer ID (expected 16-char hex)."
        case .invalidIdentityMaterial(let reason):
            return "Invalid BitChat identity material: \(reason)."
        case .identityKeySaveFailed(let keyName):
            return "Failed to persist BitChat \(keyName) identity key."
        }
    }
}

private struct BitchatBLEIdentityMaterial {
    let noisePrivateKey: Data
    let signingPrivateKey: Data
    /// 33-byte compressed Cashu P2PK pubkey ("02" + nostr x-only) announced
    /// in the SVRN extension TLV so nearby Sovran peers can lock tokens to us.
    let p2pkPubkey: Data
    let peerID: String
    let identityID: String

    init(noisePrivateKeyHex: String, signingPrivateKeyHex: String, p2pkPubkeyHex: String) throws {
        guard let noiseData = Data(hexString: noisePrivateKeyHex), noiseData.count == 32 else {
            throw BitChatBridgeError.invalidIdentityMaterial("noise key must be 32-byte hex")
        }
        guard let signingData = Data(hexString: signingPrivateKeyHex), signingData.count == 32 else {
            throw BitChatBridgeError.invalidIdentityMaterial("signing key must be 32-byte hex")
        }
        guard let p2pkData = Data(hexString: p2pkPubkeyHex), p2pkData.count == 33, p2pkData.first == 0x02 else {
            throw BitChatBridgeError.invalidIdentityMaterial("p2pk pubkey must be 33-byte 02-prefixed hex")
        }
        guard let noiseKey = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: noiseData) else {
            throw BitChatBridgeError.invalidIdentityMaterial("noise key is not a valid Curve25519 key")
        }
        guard let signingKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: signingData) else {
            throw BitChatBridgeError.invalidIdentityMaterial("signing key is not a valid Ed25519 key")
        }

        self.noisePrivateKey = noiseData
        self.signingPrivateKey = signingData
        self.p2pkPubkey = p2pkData
        let peerID = PeerID(publicKey: noiseKey.publicKey.rawRepresentation).id
        self.peerID = peerID
        // The p2pk pubkey participates so a profile switch that changes only
        // the announced lock key still tears down and recreates the service
        // (the SVRN TLV is set at start()).
        self.identityID =
            "\(peerID):\(signingKey.publicKey.rawRepresentation.hexEncodedString()):\(p2pkPubkeyHex.lowercased())"
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
    private var activeIdentityID: String?
    private var activeNickname: String?
    private var lastCBState: CBManagerState = .unknown

    /// Our own Nostr npub (bech32), derived from the profile key at `start()`.
    /// Sent in bitchat's native `[FAVORITED]:npub` favorite notification so
    /// nearby Sovran peers learn our identity / P2PK lock target the bitchat
    /// way — no custom announce TLV.
    private var selfNpub: String?

    /// peerID (16-hex) → peer's x-only Nostr pubkey hex, learned from an inbound
    /// `[FAVORITED]:npub` notification. Drives lockable-on-sight in NearPay.
    /// Guarded by `peerIdentityLock` — written on the Noise-delivery path, read
    /// from `getPeers()` on the JS thread.
    private let peerIdentityLock = NSLock()
    private var peerNostrPubkeyHexMap: [String: String] = [:]

    private func setPeerNostr(_ peerID: String, _ hex: String?) {
        peerIdentityLock.lock(); defer { peerIdentityLock.unlock() }
        if let hex { peerNostrPubkeyHexMap[peerID] = hex }
        else { peerNostrPubkeyHexMap.removeValue(forKey: peerID) }
    }

    private func peerNostr(_ peerID: String) -> String? {
        peerIdentityLock.lock(); defer { peerIdentityLock.unlock() }
        return peerNostrPubkeyHexMap[peerID]
    }

    private func clearPeerNostr() {
        peerIdentityLock.lock(); defer { peerIdentityLock.unlock() }
        peerNostrPubkeyHexMap.removeAll()
    }

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

    private func installIdentityKey(
        _ keyData: Data,
        forKey key: String,
        in keychain: ProfileScopedBitchatKeychain
    ) throws {
        if case .success(let existing) = keychain.getIdentityKeyWithResult(forKey: key), existing == keyData {
            return
        }

        switch keychain.saveIdentityKeyWithResult(keyData, forKey: key) {
        case .success:
            return
        default:
            throw BitChatBridgeError.identityKeySaveFailed(key)
        }
    }

    private func installDeterministicIdentity(
        _ identityMaterial: BitchatBLEIdentityMaterial,
        in keychain: ProfileScopedBitchatKeychain
    ) throws {
        try installIdentityKey(identityMaterial.noisePrivateKey, forKey: "noiseStaticKey", in: keychain)
        try installIdentityKey(
            identityMaterial.signingPrivateKey,
            forKey: "ed25519SigningKey",
            in: keychain
        )
    }

    func start(
        nickname: String,
        profileScope: String,
        noisePrivateKeyHex: String,
        signingPrivateKeyHex: String,
        p2pkPubkeyHex: String
    ) throws {
        let identityMaterial = try BitchatBLEIdentityMaterial(
            noisePrivateKeyHex: noisePrivateKeyHex,
            signingPrivateKeyHex: signingPrivateKeyHex,
            p2pkPubkeyHex: p2pkPubkeyHex
        )
        let scope = BitchatProfileScope.storageSuffix(for: profileScope)
        if isRunning, activeProfileScope == scope, activeIdentityID == identityMaterial.identityID {
            if activeNickname != nickname {
                bleService?.setNickname(nickname)
                activeNickname = nickname
            }
            return
        }
        if isRunning {
            stop()
        }

        let keychain = ProfileScopedBitchatKeychain(profileScope: profileScope)
        try installDeterministicIdentity(identityMaterial, in: keychain)

        isRunning = true
        activeProfileScope = scope
        activeIdentityID = identityMaterial.identityID
        activeNickname = nickname
        loadDmSummaries(for: scope)
        // Derive our npub (bech32) from the profile's x-only Nostr key. We hand
        // it to nearby peers via bitchat's native `[FAVORITED]:npub` favorite
        // notification (the identity-exchange channel) — there is no custom
        // announce TLV. p2pkPubkey is "02" + the 32-byte x-only key.
        selfNpub = try? Bech32.encode(hrp: "npub", data: Data(identityMaterial.p2pkPubkey.dropFirst()))
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
        activeIdentityID = nil
        activeNickname = nil
        dmSummaries = [:]
        // Clear identity-exchange state so a profile switch never advertises the
        // previous profile's npub or surfaces its learned peer identities.
        selfNpub = nil
        clearPeerNostr()
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

    /// Send bitchat's native favorite notification (`[FAVORITED]:npub`) to
    /// `peerIDStr`, carrying our Nostr npub. This is Sovran's identity-exchange
    /// mechanism — the recipient learns our npub (= P2PK lock target) the
    /// bitchat way, with no custom wire. If no Noise session exists yet,
    /// BLEService queues the message and triggers a handshake automatically, so
    /// callers can fire this eagerly on peer discovery. Not recorded as a DM.
    func sendFavorite(_ peerIDStr: String, isFavorite: Bool) throws {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        guard let peerIDData = Data(hexString: peerIDStr) else {
            throw BitChatBridgeError.invalidPeerID
        }
        guard let npub = selfNpub else { return }  // identity not ready yet
        let peerID = PeerID(hexData: peerIDData)
        // Append the ":nut" capability marker so a receiving Sovran peer can tell
        // us apart from a stock bitchat user who merely favorited them (and could
        // never redeem a P2PK-locked token). Rides bitchat's native favorite
        // message; stock clients keep parsing the npub and ignore the suffix.
        let content = (isFavorite ? "[FAVORITED]" : "[UNFAVORITED]") + ":" + npub + ":nut"
        service.sendMessage(content, mentions: [], to: peerID, messageID: UUID().uuidString, timestamp: nil)
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
            var dict: [String: Any] = [
                "peerID": peer.peerID.id,
                "nickname": peer.nickname,
                "isConnected": peer.isConnected,
                "hasDirectLink": link.hasPeripheral || link.hasCentral,
                "lastSeen": peer.lastSeen.timeIntervalSince1970 * 1000,
            ]
            // The peer's x-only Nostr pubkey, learned via bitchat's native
            // favorite-notification exchange (`[FAVORITED]:npub`). It IS the
            // peer's Sovran identity (kind-0 profile key) AND, "02"-prefixed,
            // the P2PK lock target. Present only once the peer has favorited us
            // back; absent for peers we haven't exchanged identity with.
            if let nostrHex = self.peerNostr(peer.peerID.id) {
                dict["nostrPubkeyHex"] = nostrHex
            }
            // The peer's announced Curve25519 noise static key — bitchat's
            // own identity, present for EVERY peer (stock clients included).
            // A stable pseudonym seed for identicons/word-pair names; it is
            // NOT a Nostr pubkey and must never be used for profile lookups.
            if let noisePublicKey = peer.noisePublicKey {
                dict["noisePublicKeyHex"] = noisePublicKey.hexEncodedString()
            }
            return dict
        }
    }

    // MARK: - Background execution

    /// JS-managed background tasks, keyed by an opaque handle returned to JS.
    /// MainActor-only.
    private var jsBackgroundTasks: [Int: UIBackgroundTaskIdentifier] = [:]
    private var nextJSBackgroundTaskHandle = 1

    /// Hold a short background-task assertion so the JS runtime gets
    /// scheduled (and has runway for a mint HTTP call) after a CoreBluetooth
    /// background wake — without it the app is suspended again almost
    /// immediately after the BLE delegate returns. No-op while active.
    /// Self-expiring: always ends after `seconds` or on system expiration.
    @MainActor
    func holdBackgroundAssertion(seconds: TimeInterval = 20, name: String) {
        guard UIApplication.shared.applicationState != .active else { return }
        var taskID: UIBackgroundTaskIdentifier = .invalid
        taskID = UIApplication.shared.beginBackgroundTask(withName: name) {
            if taskID != .invalid {
                UIApplication.shared.endBackgroundTask(taskID)
                taskID = .invalid
            }
        }
        guard taskID != .invalid else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            if taskID != .invalid {
                UIApplication.shared.endBackgroundTask(taskID)
                taskID = .invalid
            }
        }
    }

    /// Explicit JS-managed background task for the auto-redeem mint call.
    /// Returns an opaque handle (-1 when the system refuses). On system
    /// expiration the module emits `onBLEBackgroundTaskExpiring` with the
    /// handle, then the task is ended natively — JS must treat the work as
    /// interrupted and rely on its persisted queue.
    @MainActor
    func beginJSBackgroundTask(name: String) -> Int {
        let handle = nextJSBackgroundTaskHandle
        nextJSBackgroundTaskHandle += 1
        var taskID: UIBackgroundTaskIdentifier = .invalid
        taskID = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            guard let self else { return }
            self.module?.sendEvent("onBLEBackgroundTaskExpiring", ["handle": handle])
            self.endJSBackgroundTask(handle: handle)
        }
        guard taskID != .invalid else { return -1 }
        jsBackgroundTasks[handle] = taskID
        return handle
    }

    @MainActor
    func endJSBackgroundTask(handle: Int) {
        guard let taskID = jsBackgroundTasks.removeValue(forKey: handle) else { return }
        UIApplication.shared.endBackgroundTask(taskID)
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
            // BLE wake in background: keep the process alive long enough for
            // JS to classify the message (and queue a locked Nut Drop).
            holdBackgroundAssertion(name: "ble-message")
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
            holdBackgroundAssertion(name: "ble-public-message")
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
        // [sovran] Intercept bitchat's native favorite notification —
        // `[FAVORITED]:npub` / `[UNFAVORITED]:npub` carries the sender's Nostr
        // npub. We use it as the identity-exchange channel (peer = Nostr = P2PK
        // lock target) and handle it here so it never surfaces as a chat DM,
        // mirroring upstream ChatViewModel.handleFavoriteNotificationFromMesh.
        if pm.content.hasPrefix("[FAVORITED]") || pm.content.hasPrefix("[UNFAVORITED]") {
            let isFavorite = pm.content.hasPrefix("[FAVORITED]")
            // Format: "[FAVORITED]:npub[:nut]". The ":nut" marker is present only
            // for cashu-capable Sovran peers — a bare favorite from a stock
            // bitchat user must NOT make them lockable (they can't redeem a
            // locked token → funds would be stuck).
            let parts = pm.content.split(separator: ":", omittingEmptySubsequences: false)
            let isCashuCapable = parts.count >= 3 && parts[2] == "nut"
            if isCashuCapable {
                var nostrHex: String? = nil
                if let decoded = try? Bech32.decode(String(parts[1])),
                   decoded.hrp == "npub", decoded.data.count == 32 {
                    nostrHex = decoded.data.hexEncodedString()
                }
                BitChatBLEBridge.shared.setPeerNostr(peerID.id, isFavorite ? nostrHex : nil)
                Task { @MainActor in
                    BitChatBLEBridge.shared.holdBackgroundAssertion(name: "ble-favorite")
                    var event: [String: Any] = ["peerID": peerID.id, "isFavorite": isFavorite]
                    if let nostrHex { event["nostrPubkeyHex"] = nostrHex }
                    BitChatBLEBridge.shared.module?.sendEvent("onBLEPeerIdentity", event)
                }
            }
            // Ack regardless (and never surface a favorite notification as chat).
            if let service = BitChatBLEBridge.shared.bleService {
                let messageID = pm.messageID
                DispatchQueue.global(qos: .utility).async {
                    service.sendDeliveryAck(for: messageID, to: peerID)
                }
            }
            return
        }
        Task { @MainActor in
            BitChatBLEBridge.shared.holdBackgroundAssertion(name: "ble-noise-payload")
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
