import Foundation

/// Ecash capability announce extension TLV (0xF0) appended to bitchat
/// announce packets. Open extension — any bitchat client may implement it;
/// spec draft in `modules/bitchat-module/docs/nut-xx-ecash-capability-announcement.md`.
///
/// Wire format (announce payload is a TLV stream; vanilla bitchat decoders
/// skip unknown TLV types, verified against upstream `Packets.swift` and its
/// `announcementPacketRoundTripsNeighborsAndSkipsUnknownTLVs` test):
///
///   type  = 0xF0
///   len   = 40
///   value = "NUTXX" (5) | version 0x01 (1) | capability flags (1)
///           | P2PK pubkey (33 = 0x02 || nostr x-only pubkey)
///
/// 0xF0 sits far above upstream's sequential allocation (0x01–0x04 today;
/// the bitpoints.me fork already collided at 0x04) to stay out of landgrab
/// territory. The TLV is appended before the announce is signed, so the
/// Ed25519 announce signature covers it and vanilla verification still
/// passes. Decoders accept len >= 40 so future versions can append fields.
enum EcashAnnounceTLV {
    static let type: UInt8 = 0xF0
    static let magic: [UInt8] = Array("NUTXX".utf8)
    static let version: UInt8 = 0x01
    /// Capability bit 0: receiver auto-redeems P2PK-locked cashu tokens
    /// seen on the public mesh.
    static let capabilityCashuAutoRedeem: UInt8 = 0x01
    /// magic(5) + version(1) + flags(1) + compressed pubkey(33)
    static let valueLength = 40

    /// Full TLV bytes (type + length + value) for the local announce.
    /// Returns nil when the pubkey is not a 33-byte `0x02`-prefixed key.
    static func encode(p2pkPubkey: Data, flags: UInt8) -> Data? {
        guard p2pkPubkey.count == 33, p2pkPubkey.first == 0x02 else { return nil }
        var data = Data()
        data.append(type)
        data.append(UInt8(valueLength))
        data.append(contentsOf: magic)
        data.append(version)
        data.append(flags)
        data.append(p2pkPubkey)
        return data
    }

    /// Walks the announce TLV stream looking for a valid ecash extension.
    /// Tolerant of unknown TLVs (same loop shape as upstream decoders);
    /// returns nil on missing TLV, bad magic, or malformed pubkey.
    static func parse(announcePayload: Data) -> (flags: UInt8, p2pkPubkey: Data)? {
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
                guard Array(value[0..<5]) == magic else { return nil }
                // value[5] is the version — fields below are fixed-offset for
                // all versions, so unknown future versions still parse.
                let flags = value[6]
                let pubkey = Data(value[7..<40])
                guard pubkey.first == 0x02 else { return nil }
                return (flags: flags, p2pkPubkey: pubkey)
            }
            offset += length
        }
        return nil
    }
}

/// Process-wide state for the ecash capability announce extension.
///
/// Outbound: `localTLV` is set by `BitChatBLEBridge.start()` (per-profile by
/// construction — profile switches recreate the service through stop/start)
/// and appended to every announce by the patched `BLEService.sendAnnounce`.
///
/// Inbound: the patched `BLEAnnounceHandler.handle` records every VERIFIED
/// announce payload here. Announce TLVs are authoritative per-announce
/// (upstream treats omission as semantic state), so a verified announce
/// without the ecash TLV clears the peer's entry.
final class EcashAnnounceState {
    static let shared = EcashAnnounceState()

    struct PeerExtension {
        let flags: UInt8
        let p2pkPubkeyHex: String
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
        peers[peerID] = PeerExtension(
            flags: parsed.flags,
            p2pkPubkeyHex: parsed.p2pkPubkey.hexEncodedString()
        )
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
