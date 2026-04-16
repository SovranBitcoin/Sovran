/// Slice of bitchat's `MessageTextHelpers.swift` (under Views/) that the
/// non-UI Services we compile depend on. Re-declared here so we don't have
/// to pull all of Views/ into the pod just for one extension method.

#if SOVRAN_BRIDGE

import Foundation

extension String {
    func hasVeryLongToken(threshold: Int) -> Bool {
        var current = 0
        for ch in self {
            if ch.isWhitespace || ch.isNewline {
                if current >= threshold { return true }
                current = 0
            } else {
                current += 1
                if current >= threshold { return true }
            }
        }
        return current >= threshold
    }
}

#endif
