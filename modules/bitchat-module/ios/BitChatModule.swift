import ExpoModulesCore

public class BitChatModule: Module {
    public func definition() -> ModuleDefinition {
        Name("BitChat")

        // --- Events emitted to JS ---
        Events(
            "onBLEMessage",
            "onBLEPrivateMessage",
            "onBLEDeliveryStatus",
            "onBLEPeerUpdate",
            "onBLEPeerIdentity",
            "onBLEStateChanged",
            "onBLEBackgroundTaskExpiring",
            "onNostrMessage",
            "onNostrPrivateMessage"
        )

        OnCreate {
            BitChatBLEBridge.shared.attach(module: self)
            BitChatNostrBridge.shared.attach(module: self)
        }

        OnDestroy {
            BitChatBLEBridge.shared.stop()
            Task { @MainActor in
                BitChatNostrBridge.shared.stop()
            }
        }

        // --- BLE Mesh ---

        AsyncFunction("startBLE") {
            (
                nickname: String,
                profileScope: String,
                noisePrivateKeyHex: String,
                signingPrivateKeyHex: String,
                p2pkPubkeyHex: String
            ) in
            try await BitChatBLEBridge.shared.start(
                nickname: nickname,
                profileScope: profileScope,
                noisePrivateKeyHex: noisePrivateKeyHex,
                signingPrivateKeyHex: signingPrivateKeyHex,
                p2pkPubkeyHex: p2pkPubkeyHex
            )
        }

        AsyncFunction("sendBLEMessage") { (content: String) in
            try BitChatBLEBridge.shared.sendMessage(content)
        }

        /// Establishes the Noise session (lazy handshake) with a peer
        /// before the user's first DM. Safe to call repeatedly.
        AsyncFunction("startBLEPrivateChat") { (peerID: String) in
            try BitChatBLEBridge.shared.startPrivateChat(peerID)
        }

        /// Clear the Noise session for `peerID` so the next outbound DM
        /// triggers a fresh handshake. The JS-side watchdog calls this when
        /// a `sending`-state message hasn't progressed to `sent` within a
        /// timeout — likely a stuck handshake or invalidated session.
        AsyncFunction("resetBLEPrivateChat") { (peerID: String) in
            try BitChatBLEBridge.shared.resetPrivateChat(peerID)
        }

        /// Send a Noise-encrypted DM. `messageID` is provided by the JS caller
        /// so the optimistic bubble and later `onBLEDeliveryStatus` events
        /// (sent / delivered / failed) correlate on a single key. `nickname`
        /// is our own nickname — upstream stamps it on the persisted message
        /// for the recipient's display.
        AsyncFunction("sendBLEPrivateMessage") {
            (peerID: String, content: String, nickname: String, messageID: String) -> String in
            return try BitChatBLEBridge.shared.sendPrivateMessage(
                content,
                to: peerID,
                nickname: nickname,
                messageID: messageID
            )
        }

        /// Send bitchat's native favorite notification (`[FAVORITED]:npub`) to a
        /// peer, handing them our Nostr identity the bitchat way. NearPay calls
        /// this eagerly on peer discovery; the recipient (if Sovran) reciprocates
        /// and learns our P2PK lock target. Queued + handshake-triggered if no
        /// Noise session exists yet.
        AsyncFunction("sendBLEFavorite") { (peerID: String, isFavorite: Bool) in
            try BitChatBLEBridge.shared.sendFavorite(peerID, isFavorite: isFavorite)
        }

        Function("getBLEPeers") { () -> [[String: Any]] in
            return BitChatBLEBridge.shared.getPeers()
        }

        /// Returns the persisted 1:1 DM-peer history (peerID + best-known
        /// nickname + last activity timestamp) sorted by recency. Survives app
        /// restarts via UserDefaults — used by the Contacts screen's Recent /
        /// All tabs to surface peers we've DM'd in past sessions.
        Function("getBLEDmHistory") { (profileScope: String) -> [[String: Any]] in
            return BitChatBLEBridge.shared.getDmHistory(profileScope: profileScope)
        }

        Function("getBLEState") { () -> String in
            return BitChatBLEBridge.shared.bluetoothState
        }

        /// Begin a UIKit background task so a JS network call (e.g. the Nut
        /// Drop auto-redeem mint swap) can finish after a BLE background
        /// wake. Returns an opaque handle (-1 when refused). The
        /// `onBLEBackgroundTaskExpiring` event fires if the system reclaims
        /// the task before `endBLEBackgroundTask` is called.
        AsyncFunction("beginBLEBackgroundTask") { (name: String) -> Int in
            await MainActor.run {
                BitChatBLEBridge.shared.beginJSBackgroundTask(name: name)
            }
        }

        AsyncFunction("endBLEBackgroundTask") { (handle: Int) in
            await MainActor.run {
                BitChatBLEBridge.shared.endJSBackgroundTask(handle: handle)
            }
        }

        // --- Nostr (upstream bitchat's NostrRelayManager + GeoRelayDirectory + per-geohash identity) ---

        AsyncFunction("startNostr") { (profileScope: String) in
            await MainActor.run {
                BitChatNostrBridge.shared.start(profileScope: profileScope)
            }
        }

        AsyncFunction("joinGeohash") { (geohash: String) in
            try await MainActor.run {
                try BitChatNostrBridge.shared.joinGeohash(geohash)
            }
        }

        AsyncFunction("leaveGeohash") {
            await MainActor.run {
                BitChatNostrBridge.shared.leaveGeohash()
            }
        }

        AsyncFunction("sendGeohashMessage") { (content: String, nickname: String) in
            let nick: String? = nickname.isEmpty ? nil : nickname
            try await MainActor.run {
                try BitChatNostrBridge.shared.sendMessage(content, nickname: nick)
            }
        }

        /// Send a NIP-17 gift-wrapped DM to another participant in the
        /// currently-joined geohash. `recipientPubkey` is the hex Nostr
        /// pubkey observed on the other user's public geohash messages
        /// (via `onNostrMessage` → `senderPubkey`).
        AsyncFunction("sendGeohashPrivateMessage") {
            (recipientPubkey: String, content: String) in
            try await MainActor.run {
                try BitChatNostrBridge.shared.sendPrivateMessage(to: recipientPubkey, content: content)
            }
        }
    }
}
