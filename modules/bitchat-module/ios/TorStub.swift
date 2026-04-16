/// No-op Tor stubs for Sovran bridge.
/// BitChat's code references TorManager and TorURLSession — we stub them so
/// the BLE and Nostr layers compile without the Arti/Rust xcframeworks.
/// When Tor is unavailable, BitChat falls back to direct relay connections.

import Foundation

#if SOVRAN_BRIDGE

@MainActor
public final class TorManager: ObservableObject {
    public static let shared = TorManager()

    @Published public var isReady: Bool = false
    public var torEnforced: Bool { false }

    public func isForeground() -> Bool { false }
    public func awaitReady() async -> Bool { false }
    public func start() {}
    public func stop() {}

    // NetworkActivationTorControlling
    public func setAutoStartAllowed(_ allowed: Bool) {}
    public func startIfNeeded() {}
    public func shutdownCompletely() {}
}

public final class TorURLSession {
    public static let shared = TorURLSession()
    public var session: URLSession { URLSession.shared }

    // NetworkActivationProxyControlling
    public func setProxyMode(useTor: Bool) {}
}

public extension Notification.Name {
    static let torReady = Notification.Name("torReady")
    static let torForegroundChanged = Notification.Name("torForegroundChanged")
    static let TorUserPreferenceChanged = Notification.Name("TorUserPreferenceChanged")
    static let TorDidBecomeReady = Notification.Name("TorDidBecomeReady")
    static let TorWillRestart = Notification.Name("TorWillRestart")
    static let TorWillStart = Notification.Name("TorWillStart")
}

#endif
