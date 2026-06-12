import Foundation

/// Vendor Noise-payload range for the Nut Drop NUT-18 exchange (solicit /
/// payment request / payment / status). Chosen clear of upstream's
/// 0x01–0x11 allocations and PR #1053's informally squatted 0x20–0x31.
/// Stock clients drop unknown payload types silently (verified both
/// platforms), so these are invisible outside Sovran-capable peers — and
/// senders only emit them to peers that announced the capability beacon.
enum NutPayloadRange {
    static let first: UInt8 = 0xA0
    static let last: UInt8 = 0xA3

    static func contains(_ type: UInt8) -> Bool {
        type >= first && type <= last
    }
}

/// Relay between the vendored BLE stack and `BitChatBLEBridge` for the Nut
/// Drop Noise payloads. The native layer is a dumb byte pipe: the patched
/// `BLENoisePacketHandler` routes any decrypted payload whose type byte is
/// in the vendor range here, and the bridge forwards the raw bytes to JS,
/// where ALL Cashu semantics live (creq parsing, solicit correlation,
/// payment validation). Unparseable vendor bytes are dropped JS-side.
final class NutPayloadRelay {
    static let shared = NutPayloadRelay()

    private let lock = NSLock()
    private var _onInbound: ((_ peerID: String, _ typedPayload: Data, _ timestampMs: UInt64) -> Void)?

    private init() {}

    /// Installed by the bridge on start, cleared on stop (profile switches
    /// recreate the service through stop/start, so a stale handler can never
    /// deliver payloads across profiles).
    var onInbound: ((_ peerID: String, _ typedPayload: Data, _ timestampMs: UInt64) -> Void)? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _onInbound
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _onInbound = newValue
        }
    }

    /// Called from the patched vendor dispatch with the FULL typed payload
    /// (type byte included) of a vendor-range noise payload.
    func receive(peerID: String, typedPayload: Data, timestampMs: UInt64) {
        onInbound?(peerID, typedPayload, timestampMs)
    }
}
