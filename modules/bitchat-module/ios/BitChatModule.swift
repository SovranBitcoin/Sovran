import ExpoModulesCore

public class BitChatModule: Module {
    public func definition() -> ModuleDefinition {
        Name("BitChat")

        // --- Events emitted to JS ---
        Events("onBLEMessage", "onBLEPeerUpdate", "onBLEStateChanged", "onNostrMessage")

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

        // --- Geohash encode/decode (sync, no state) ---

        Function("encodeGeohash") { (latitude: Double, longitude: Double, precision: Int) -> String in
            return BitChatGeohash.encode(latitude: latitude, longitude: longitude, precision: precision)
        }

        Function("decodeGeohash") { (hash: String) -> [String: Double] in
            let center = BitChatGeohash.decodeCenter(hash)
            return ["lat": center.lat, "lon": center.lon]
        }

        Function("neighbors") { (hash: String) -> [String] in
            return BitChatGeohash.neighbors(of: hash)
        }

        // --- Geo relay directory (upstream bitchat's 304-entry CSV, Haversine) ---

        AsyncFunction("closestRelays") { (latitude: Double, longitude: Double, count: Int) -> [String] in
            await MainActor.run {
                BitChatNostrBridge.shared.closestRelays(toLat: latitude, lon: longitude, count: count)
            }
        }

        AsyncFunction("closestRelaysForGeohash") { (hash: String, count: Int) -> [String] in
            await MainActor.run {
                BitChatNostrBridge.shared.closestRelays(toGeohash: hash, count: count)
            }
        }

        // --- BLE Mesh ---

        AsyncFunction("startBLE") { (nickname: String) in
            await BitChatBLEBridge.shared.start(nickname: nickname)
        }

        AsyncFunction("stopBLE") {
            await BitChatBLEBridge.shared.stop()
        }

        AsyncFunction("sendBLEMessage") { (content: String) in
            try BitChatBLEBridge.shared.sendMessage(content)
        }

        Function("getBLEPeers") { () -> [[String: Any]] in
            return BitChatBLEBridge.shared.getPeers()
        }

        Function("getBLEState") { () -> String in
            return BitChatBLEBridge.shared.bluetoothState
        }

        Function("getBLEDiagnostics") { () -> [String: Any] in
            return BitChatBLEBridge.shared.getDiagnostics()
        }

        // --- Nostr (upstream bitchat's NostrRelayManager + GeoRelayDirectory + per-geohash identity) ---

        AsyncFunction("startNostr") {
            await MainActor.run {
                BitChatNostrBridge.shared.start()
            }
        }

        AsyncFunction("stopNostr") {
            await MainActor.run {
                BitChatNostrBridge.shared.stop()
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
    }
}
