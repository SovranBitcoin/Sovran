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

    var errorDescription: String? {
        switch self {
        case .notStarted:
            return "BLE mesh is not started. Call startBLE() first."
        }
    }
}

final class BitChatBLEBridge: NSObject {
    static let shared = BitChatBLEBridge()

    private var bleService: BLEService?
    private var module: BitChatModule?
    private var isRunning = false
    private var lastCBState: CBManagerState = .unknown

    private override init() {
        super.init()
    }

    func attach(module: BitChatModule) {
        self.module = module
    }

    func start(nickname: String) {
        guard !isRunning else { return }
        isRunning = true

        let keychain = KeychainManager()
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
    }

    func sendMessage(_ content: String) throws {
        guard let service = bleService else {
            throw BitChatBridgeError.notStarted
        }
        service.sendMessage(content, mentions: [])
    }

    func getPeers() -> [[String: Any]] {
        guard let service = bleService else { return [] }
        return service.currentPeerSnapshots().map { peer in
            [
                "peerID": peer.peerID.id,
                "nickname": peer.nickname,
                "isConnected": peer.isConnected,
                "lastSeen": peer.lastSeen.timeIntervalSince1970 * 1000,
            ] as [String: Any]
        }
    }

    /// Native CoreBluetooth state snapshot for debugging.
    /// Tells us whether scanning/advertising is actually running — which is
    /// notoriously hard to diagnose purely from JS-side `onBLEStateChanged`
    /// events, because those only report the CBManager powered state, not
    /// whether we actually called `scanForPeripherals` / `startAdvertising`.
    ///
    /// Also exposes the raw BLE link state (connected peripherals,
    /// subscribed centrals, pending inbound write buffers) so we can tell
    /// whether the asymmetry is "link exists but inbound announce never
    /// arrives" vs "no link at all". Reads go through BLEService's own
    /// dispatch queues to avoid racing against mutations.
    func getDiagnostics() -> [String: Any] {
        guard let service = bleService else {
            return [
                "isRunning": isRunning,
                "centralState": "nil",
                "peripheralState": "nil",
                "isScanning": false,
                "isAdvertising": false,
                "peerCount": 0,
                "connectedPeers": 0,
                "connectedPeripherals": 0,
                "subscribedCentrals": 0,
                "pendingWriteBuffers": 0,
                "announcedPeers": 0,
            ]
        }

        let central = service.centralManager
        let peripheral = service.peripheralManager

        // BLE-layer link counts. Run on BLEService's own queues so we don't
        // race with mutations from CoreBluetooth delegate callbacks.
        //
        // `peripheralsSubscribed` is the count of connected peripherals whose
        // `characteristic` has been populated — i.e. we completed service +
        // characteristic discovery AND called `setNotifyValue(true, …)`.
        // This is the gate between "CBPeripheral.state == .connected" and
        // "we can receive notifications from this device". If connected but
        // not subscribed, the remote's `updateValue` notifications never
        // reach us.
        let (connectedPeripherals, peripheralsSubscribed, pendingWriteBuffers) = service.bleQueue.sync {
            (
                service.peripherals.values.filter { $0.isConnected }.count,
                service.peripherals.values.filter { $0.isConnected && $0.characteristic != nil }.count,
                service.pendingWriteBuffers.count
            )
        }
        let (subscribedCentrals, announcedPeers) = service.collectionsQueue.sync {
            (service.subscribedCentrals.count, service.peers.count)
        }

        // Inbound-notification counters injected into upstream BLEService by
        // patch-bitchat-imports.js. `inboundNotifyCount` ticks on every
        // `didUpdateValueFor` delegate callback from CoreBluetooth. If this
        // stays at 0 while peripheralsSubscribed ≥ 1, the remote never sends
        // notifications. If it climbs but announcedPeers stays 0, notifications
        // are firing but decode/validate is silently rejecting them.
        //
        // handleAnnounce-gate counters fire only if notifications reach the
        // announce-dispatch path. They tell us *which* gate is dropping.
        let (notifyCount, notifyErrorCount, notifyEmptyCount,
             announceReceived, announceDecodeFail, announceSenderMismatch,
             announceStale, announceSigFail, announceUnverified, announceAccepted) =
            service.bleQueue.sync {
                (service.inboundNotifyCount, service.inboundNotifyErrorCount, service.inboundNotifyEmptyCount,
                 service.announceReceivedCount, service.announceDecodeFailCount, service.announceSenderMismatchCount,
                 service.announceStaleCount, service.announceSigFailCount, service.announceUnverifiedCount,
                 service.announceAcceptedCount)
            }

        return [
            "isRunning": isRunning,
            "centralState": stateString(central?.state),
            "peripheralState": stateString(peripheral?.state),
            "isScanning": central?.isScanning ?? false,
            "isAdvertising": peripheral?.isAdvertising ?? false,
            "peerCount": service.currentPeerSnapshots().count,
            "connectedPeers": service.currentPeerSnapshots().filter { $0.isConnected }.count,
            "connectedPeripherals": connectedPeripherals,
            "peripheralsSubscribed": peripheralsSubscribed,
            "subscribedCentrals": subscribedCentrals,
            "pendingWriteBuffers": pendingWriteBuffers,
            "announcedPeers": announcedPeers,
            "inboundNotifyCount": notifyCount,
            "inboundNotifyErrorCount": notifyErrorCount,
            "inboundNotifyEmptyCount": notifyEmptyCount,
            "announceReceivedCount": announceReceived,
            "announceDecodeFailCount": announceDecodeFail,
            "announceSenderMismatchCount": announceSenderMismatch,
            "announceStaleCount": announceStale,
            "announceSigFailCount": announceSigFail,
            "announceUnverifiedCount": announceUnverified,
            "announceAcceptedCount": announceAccepted,
        ]
    }

    private func stateString(_ state: CBManagerState?) -> String {
        guard let state else { return "nil" }
        switch state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .resetting: return "resetting"
        case .unknown: return "unknown"
        @unknown default: return "unknown_\(state.rawValue)"
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

    nonisolated func didUpdateMessageDeliveryStatus(_ messageID: String, status: DeliveryStatus) {}

    nonisolated func didReceiveNoisePayload(from peerID: PeerID, type: NoisePayloadType, payload: Data, timestamp: Date) {}

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
