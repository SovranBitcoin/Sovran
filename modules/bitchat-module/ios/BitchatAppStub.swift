/// Stub for `BitchatApp` constants referenced by bitchat sources we compile.
/// The real `BitchatApp.swift` is the SwiftUI App entry point and is excluded
/// from the pod (Sovran provides its own host app), so we re-declare the
/// handful of static constants other files depend on.

#if SOVRAN_BRIDGE

import Foundation

enum BitchatApp {
    static let bundleID = Bundle.main.bundleIdentifier ?? "money.sovran"
    static let groupID = "group.\(bundleID)"
}

#endif
