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
            "onBLEStateChanged",
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

        AsyncFunction("startBLE") { (nickname: String) in
            await BitChatBLEBridge.shared.start(nickname: nickname)
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

        Function("getBLEPeers") { () -> [[String: Any]] in
            return BitChatBLEBridge.shared.getPeers()
        }

        /// Returns the persisted 1:1 DM-peer history (peerID + best-known
        /// nickname + last activity timestamp) sorted by recency. Survives app
        /// restarts via UserDefaults — used by the Contacts screen's Recent /
        /// All tabs to surface peers we've DM'd in past sessions.
        Function("getBLEDmHistory") { () -> [[String: Any]] in
            return BitChatBLEBridge.shared.getDmHistory()
        }

        Function("getBLEState") { () -> String in
            return BitChatBLEBridge.shared.bluetoothState
        }

        // --- Nostr (upstream bitchat's NostrRelayManager + GeoRelayDirectory + per-geohash identity) ---

        AsyncFunction("startNostr") {
            await MainActor.run {
                BitChatNostrBridge.shared.start()
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
