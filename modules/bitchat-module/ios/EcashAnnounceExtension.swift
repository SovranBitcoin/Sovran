import Foundation

/// Ecash capability beacon TLV (0xF0) appended to bitchat announce packets.
/// Open extension — any bitchat client may implement it; spec draft in
/// `modules/bitchat-module/docs/nut18-bitchat-transport.md`.
///
/// v3 ("NUTB"): a 39-byte beacon carrying the peer's capability flags AND its
/// 33-byte compressed secp256k1 P2PK key ("02" + x-only Nostr pubkey). That
/// single announced key IS the peer's whole Sovran identity — the radar
/// derives the Nostr pubkey (drop the "02" → kind-0 profile → real face), the
/// P2PK lock target, and a stable identity seed all from it. Ecash is then
/// locked to that key and broadcast on the public mesh; there is no Noise
/// handshake. (Privacy note: announcing a static key is a cross-nickname
/// correlator — accepted so peer = Nostr = p2pk identity comes for free.)
///
/// Wire format (announce payload is a TLV stream; vanilla bitchat decoders
/// skip unknown TLV types — tolerant decoder, verified on both platforms):
///
///   type  = 0xF0
///   len   = 39
///   value = "NUTB" (4) | version 0x03 (1) | capability flags (1) | p2pk (33)
///   flags : bit0 = answers cashu payment requests (legacy/informational)
///           bit1 = auto-redeems received ecash (radar "instant" badge)
///           bits 2–7 reserved: 0 on send, ignored on receive
///   p2pk  : 33-byte compressed secp256k1 key, "02"-prefixed
///
/// Versioning: the value layout is append-only (decoders MUST ignore trailing
/// bytes); the version bumps only on incompatible relayout; any version we
/// don't support — including the v2 flags-only beacon and the legacy 40-byte
/// "NUTXX" v1 beacon — means the peer is treated as vanilla. The TLV is
/// appended before the announce is signed, so the Ed25519 announce signature
/// covers it and vanilla verification still passes. At 39 bytes the beacon
/// stays below the 100-byte payload-compression threshold implicated in the
/// cross-platform announce-signature bug.
enum EcashAnnounceTLV {
    static let type: UInt8 = 0xF0
    static let magic: [UInt8] = Array("NUTB".utf8)
    static let version: UInt8 = 0x03
    /// Answers cashu payment requests (legacy/informational bit).
    static let capabilityNutRequests: UInt8 = 0x01
    /// Auto-redeems received ecash (informational — drives a radar badge).
    static let capabilityAutoRedeem: UInt8 = 0x02
    /// 33-byte compressed secp256k1 P2PK key ("02" + x-only Nostr pubkey).
    static let p2pkLength = 33
    /// Smallest valid value: magic(4) + version(1) + flags(1).
    static let minValueLength = 6
    /// Full value with the key: magic(4) + version(1) + flags(1) + p2pk(33).
    static let valueLength = 39

    /// Decoded beacon contents.
    struct Parsed {
        let flags: UInt8
        /// Present when the v3 beacon carries the 33-byte "02"-prefixed key.
        let p2pkPubkey: Data?
    }

    /// Full TLV bytes (type + length + value) for the local announce.
    static func encode(flags: UInt8, p2pkPubkey: Data) -> Data {
        var data = Data()
        data.append(type)
        data.append(UInt8(valueLength))
        data.append(contentsOf: magic)
        data.append(version)
        data.append(flags)
        data.append(p2pkPubkey)
        return data
    }

    /// Walks the announce TLV stream looking for a valid v3 beacon.
    /// Tolerant of unknown TLVs (same loop shape as upstream decoders);
    /// returns nil — peer is vanilla — on missing TLV, bad magic, or an
    /// unsupported version (v2 flags-only and legacy "NUTXX" v1 beacons).
    static func parse(announcePayload: Data) -> Parsed? {
        let bytes = [UInt8](announcePayload)
        var offset = 0
        while offset + 2 <= bytes.count {
            let tlvType = bytes[offset]
            let length = Int(bytes[offset + 1])
            offset += 2
            guard offset + length <= bytes.count else { return nil }
            if tlvType == type {
                guard length >= minValueLength else { return nil }
                let value = Array(bytes[offset..<(offset + length)])
                guard Array(value[0..<4]) == magic else { return nil }
                guard value[4] == version else { return nil }
                let flags = value[5]
                // The key is append-only; read it when present and well-formed.
                var p2pkPubkey: Data?
                if length >= valueLength, value[6] == 0x02 {
                    p2pkPubkey = Data(value[6..<valueLength])
                }
                return Parsed(flags: flags, p2pkPubkey: p2pkPubkey)
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
        /// The peer's announced 33-byte "02"-prefixed P2PK key, when present.
        let p2pkPubkey: Data?

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
        let parsed = EcashAnnounceTLV.parse(announcePayload: announcePayload)
        lock.lock()
        defer { lock.unlock() }
        guard let parsed else {
            peers.removeValue(forKey: peerID)
            return
        }
        if peers[peerID] == nil, peers.count >= maxEntries {
            return
        }
        peers[peerID] = PeerExtension(flags: parsed.flags, p2pkPubkey: parsed.p2pkPubkey)
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
