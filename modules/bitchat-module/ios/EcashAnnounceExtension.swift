import Foundation

/// Ecash capability beacon TLV (0xF0) appended to bitchat announce packets.
/// Open extension — any bitchat client may implement it; spec draft in
/// `modules/bitchat-module/docs/nut18-bitchat-transport.md`.
///
/// v2 ("NUTB"): a 6-byte flags-only beacon. It deliberately carries NO key
/// material — the receiver's P2PK lock key and trusted-mint allowlist travel
/// per-send inside the Noise channel as a NUT-18 payment request, so the
/// beacon can never go stale and a static key is never broadcast (it was a
/// cross-nickname correlator). The beacon's only job is the radar
/// affordance: "this peer answers cashu payment-request solicits".
///
/// Wire format (announce payload is a TLV stream; vanilla bitchat decoders
/// skip unknown TLV types — tolerant decoder, verified on both platforms):
///
///   type  = 0xF0
///   len   = 6
///   value = "NUTB" (4) | version 0x02 (1) | capability flags (1)
///   flags : bit0 = answers NUT-18 solicits over Noise (0xA0–0xA3)
///           bit1 = auto-redeems received ecash (radar "instant" badge)
///           bits 2–7 reserved: 0 on send, ignored on receive
///
/// Versioning kept minimal: the value layout is append-only (decoders MUST
/// ignore trailing bytes); the version bumps only on incompatible relayout;
/// any version we don't support — including the legacy 40-byte "NUTXX" v1
/// beacon — means the peer is treated as vanilla. The TLV is appended
/// before the announce is signed, so the Ed25519 announce signature covers
/// it and vanilla verification still passes. At 6 bytes the beacon also
/// stays far below the 100-byte payload-compression threshold implicated in
/// the cross-platform announce-signature bug.
enum EcashAnnounceTLV {
    static let type: UInt8 = 0xF0
    static let magic: [UInt8] = Array("NUTB".utf8)
    static let version: UInt8 = 0x02
    /// Answers NUT-18 payment-request solicits over the Noise channel.
    static let capabilityNutRequests: UInt8 = 0x01
    /// Auto-redeems received ecash (informational — drives a radar badge).
    static let capabilityAutoRedeem: UInt8 = 0x02
    /// magic(4) + version(1) + flags(1)
    static let valueLength = 6

    /// Full TLV bytes (type + length + value) for the local announce.
    static func encode(flags: UInt8) -> Data {
        var data = Data()
        data.append(type)
        data.append(UInt8(valueLength))
        data.append(contentsOf: magic)
        data.append(version)
        data.append(flags)
        return data
    }

    /// Walks the announce TLV stream looking for a valid v2 beacon.
    /// Tolerant of unknown TLVs (same loop shape as upstream decoders);
    /// returns nil — peer is vanilla — on missing TLV, bad magic, or an
    /// unsupported version (including legacy "NUTXX" v1 beacons).
    static func parse(announcePayload: Data) -> UInt8? {
        let bytes = [UInt8](announcePayload)
        var offset = 0
        while offset + 2 <= bytes.count {
            let tlvType = bytes[offset]
            let length = Int(bytes[offset + 1])
            offset += 2
            guard offset + length <= bytes.count else { return nil }
            if tlvType == type {
                guard length >= valueLength else { return nil }
                let value = Array(bytes[offset..<(offset + length)])
                guard Array(value[0..<4]) == magic else { return nil }
                guard value[4] == version else { return nil }
                // Trailing bytes beyond the flags are future fields — ignored.
                return value[5]
            }
            offset += length
        }
        return nil
    }
}

/// Process-wide state for the ecash capability beacon.
///
/// Outbound: `localTLV` is set by `BitChatBLEBridge.start()` (per-profile by
/// construction — profile switches recreate the service through stop/start)
/// and appended to every announce by the patched `BLEService.sendAnnounce`.
///
/// Inbound: the patched `BLEAnnounceHandler.handle` records every VERIFIED
/// announce payload here. Announce TLVs are authoritative per-announce
/// (upstream treats omission as semantic state), so a verified announce
/// without the beacon clears the peer's entry.
final class EcashAnnounceState {
    static let shared = EcashAnnounceState()

    struct PeerExtension {
        let flags: UInt8

        var supportsNutRequests: Bool { flags & EcashAnnounceTLV.capabilityNutRequests != 0 }
        var autoRedeem: Bool { flags & EcashAnnounceTLV.capabilityAutoRedeem != 0 }
    }

    private let lock = NSLock()
    private var _localTLV: Data?
    private var peers: [String: PeerExtension] = [:]
    /// Announce-rate policing upstream bounds growth already; this cap is a
    /// backstop against unbounded memory on a hostile mesh.
    private let maxEntries = 256

    private init() {}

    var localTLV: Data? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _localTLV
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _localTLV = newValue
        }
    }

    /// Called from the patched announce handler for verified announces only.
    func record(peerID: String, announcePayload: Data) {
        let flags = EcashAnnounceTLV.parse(announcePayload: announcePayload)
        lock.lock()
        defer { lock.unlock() }
        guard let flags else {
            peers.removeValue(forKey: peerID)
            return
        }
        if peers[peerID] == nil, peers.count >= maxEntries {
            return
        }
        peers[peerID] = PeerExtension(flags: flags)
    }

    func lookup(peerID: String) -> PeerExtension? {
        lock.lock()
        defer { lock.unlock() }
        return peers[peerID]
    }

    func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        peers.removeAll()
    }
}
