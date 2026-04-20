import SwiftUI
import UIKit

@available(iOS 17.0, *)
@Observable
final class UpstreamLiquidGlassTextModel {
    var text: String = ""
    var fontName: String = ""
    var fontSize: CGFloat = 48
    var fontWeight: UIFont.Weight = .heavy
    var tint: UIColor? = nil
    var glassVariant: String = "regular"
    var interactive: Bool = false

    // Same font-name coercion as our in-tree module: expo-font registers by
    // the key name ("OverpassHeavy"), but UIFont wants the PostScript name
    // ("Overpass-Heavy"). Try both spellings.
    private func fontNameCandidates() -> [String] {
        guard !fontName.isEmpty else { return [] }
        var out: [String] = [fontName]
        if !fontName.contains("-") {
            var buf = ""
            for ch in fontName {
                if let prev = buf.last, prev.isLowercase, ch.isUppercase {
                    buf.append("-")
                }
                buf.append(ch)
            }
            if buf != fontName { out.append(buf) }
        }
        return out
    }

    func resolvedFont() -> UIFont {
        for candidate in fontNameCandidates() {
            if let f = UIFont(name: candidate, size: fontSize) { return f }
        }
        return UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
    }

    func buildAttributedString() -> NSAttributedString {
        var attrs: [NSAttributedString.Key: Any] = [.font: resolvedFont()]
        if let c = tint { attrs[.foregroundColor] = c }
        return NSAttributedString(string: text, attributes: attrs)
    }
}

@available(iOS 17.0, *)
struct UpstreamLiquidGlassTextRoot: View {
    @Bindable var model: UpstreamLiquidGlassTextModel

    var body: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *),
           NSClassFromString("UIGlassEffect") != nil {
            // Delegate directly to the upstream view. This is the *entire*
            // point of the parallel module — we want to compare its output
            // against our `liquid-glass-text` implementation without
            // reimplementing anything.
            UpstreamLiquidGlassTextSwiftUI(
                model.buildAttributedString(),
                glass: resolvedGlass()
            )
            .accessibilityLabel(model.text)
        } else {
            nativeFallback()
        }
        #else
        nativeFallback()
        #endif
    }

    #if compiler(>=6.2)
    @available(iOS 26.0, *)
    private func resolvedGlass() -> Glass {
        var g: Glass = (model.glassVariant == "clear") ? .clear : .regular
        if let tint = model.tint { g = g.tint(Color(tint)) }
        if model.interactive     { g = g.interactive(true) }
        return g
    }
    #endif

    @ViewBuilder
    private func nativeFallback() -> some View {
        Text(AttributedString(model.buildAttributedString()))
            .foregroundStyle(Color(model.tint ?? .label))
    }
}
