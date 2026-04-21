//
//  Vendored from https://github.com/DanielCrompton123/LiquidGlassText
//  (MIT licensed). Renamed + namespaced so it can be statically linked
//  alongside our in-tree `liquid-glass-text` module without symbol collisions.
//
//  Upstream file: Sources/LiquidGlassText/LiquidGlassText.swift
//

import SwiftUI
import CoreText

#if compiler(>=6.2)

// Gated to iOS 26+ because the Glass symbol / glassEffect(_:in:) live in
// the iOS 26 SDK only. On earlier OS versions the upstream library simply
// cannot render — the caller is expected to branch on availability.
@available(iOS 26.0, *)
public struct UpstreamLiquidGlassTextSwiftUI: View {

    // MARK: - Properties
    private let string: NSAttributedString
    private let glass: Glass

    // MARK: - Initializers
    public init(_ string: NSAttributedString, glass: Glass = .regular) {
        self.string = string
        self.glass = glass
    }

    public init(_ string: String, glass: Glass = .regular) {
        self.string = NSAttributedString(string: string)
        self.glass = glass
    }

    public init(
        _ string: String,
        glass: Glass = .regular,
        size: CGFloat = UXFont.systemFontSize,
        weight: UXWeight = .regular,
        width: UXWidth = .standard,
        design: UXDesign = .default
    ) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UpstreamFontHelper.font(forSize: size, weight: weight, width: width, design: design)
        ]
        self.string = NSAttributedString(string: string, attributes: attrs)
        self.glass = glass
    }

    public init(_ string: String, glass: Glass = .regular, fontName: String, size: CGFloat = UXFont.systemFontSize) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UpstreamFontHelper.font(named: fontName, size: size)
        ]
        self.string = NSAttributedString(string: string, attributes: attrs)
        self.glass = glass
    }

    // MARK: - Body
    public var body: some View {
        let path = UpstreamTextHelper.path(for: string)

        Color.clear
            .glassEffect(glass, in: path)
            .frame(width: path.boundingRect.width, height: path.boundingRect.height)
    }
}

#endif
