import SwiftUI
import UIKit

@available(iOS 17.0, *)
@Observable
final class LiquidGlassTextModel {
    var text: String = ""
    var fontName: String = ""
    var fontSize: CGFloat = 48
    var fontWeight: UIFont.Weight = .heavy
    var tint: UIColor? = nil
    var glassVariant: String = "regular"
    var interactive: Bool = false
    /// "" inherits the window trait; "light" / "dark" forces the SwiftUI
    /// `\.colorScheme` env value so the glass material renders in the matching
    /// mode even though `userInterfaceStyle: 'dark'` is locked at the window
    /// level in app.json.
    var colorScheme: String = ""
    var debugShape: String = "none"

    func resolvedFont() -> UIFont {
        for candidate in fontNameCandidates() {
            if let f = UIFont(name: candidate, size: fontSize) { return f }
        }
        return UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
    }

    // RN's expo-font exposes the font via the useFonts() key (e.g. "OverpassHeavy"),
    // but CoreText / UIFont(name:) wants the font file's PostScript name
    // (e.g. "Overpass-Heavy"). Try both spellings.
    private func fontNameCandidates() -> [String] {
        guard !fontName.isEmpty else { return [] }
        var out: [String] = [fontName]
        // Insert hyphens before lower-to-upper transitions:
        // "OverpassHeavy" -> "Overpass-Heavy"
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

    func buildAttributedString() -> NSAttributedString {
        var attrs: [NSAttributedString.Key: Any] = [.font: resolvedFont()]
        if let c = tint { attrs[.foregroundColor] = c }
        return NSAttributedString(string: text, attributes: attrs)
    }
}

// Simple Path-based square. Proves that glassEffect(_, in:) works with a
// hand-rolled custom Shape that draws into its rect. If this is visible but
// TextShape is not, the bug is in glyph-path generation, not the glass effect.
struct DebugSquareShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        return p
    }
}

// Stroked text outline (hollow letters). Gives glass a visible ring even if
// the filled-glyph path is too thin at this font size.
@available(iOS 17.0, *)
struct StrokedTextShape: Shape {
    let attributedString: NSAttributedString
    let lineWidth: CGFloat

    func path(in rect: CGRect) -> Path {
        let filled = TextShape(attributedString).path(in: rect)
        return filled.strokedPath(StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
    }
}

/// Forces the SwiftUI `colorScheme` env value when `scheme` is "light" or
/// "dark". Any other value (incl. "") inherits the window trait — the app
/// pins `userInterfaceStyle: 'dark'` so the inherited value is `.dark`,
/// which is why the JS side passes an explicit scheme on light themes.
@available(iOS 17.0, *)
struct SchemeOverrideModifier: ViewModifier {
    let scheme: String

    func body(content: Content) -> some View {
        switch scheme {
        case "light": content.environment(\.colorScheme, .light)
        case "dark":  content.environment(\.colorScheme, .dark)
        default:      content
        }
    }
}

@available(iOS 17.0, *)
struct LiquidGlassTextRoot: View {
    @Bindable var model: LiquidGlassTextModel

    // Fixed debug frame for non-text shapes so the user sees something even
    // when font rendering is broken. Matches the typical balance height.
    private var debugFrame: CGSize { CGSize(width: 240, height: 80) }

    var body: some View {
        AnyView(content.modifier(SchemeOverrideModifier(scheme: model.colorScheme)))
    }

    @ViewBuilder
    private var content: some View {
        let mode = model.debugShape

        // For debug shapes we ignore the text-derived size and use a fixed
        // frame — this isolates "is glass rendering at all?" from "is the
        // glyph path the right size?".
        if mode != "none" && mode != "textFilled" && mode != "textStroked" {
            glassified(anyShape: resolveDebugShape(mode), frameSize: debugFrame, suppressTint: true)
                .frame(width: debugFrame.width, height: debugFrame.height)
                .accessibilityLabel("debug:\(mode)")
        } else {
            // Text-based paths (default + stroked variant).
            let attr = model.buildAttributedString()
            let textShape = TextShape(attr, alignment: .center)
            let size = textShape.sizeThatFits(.unspecified)
            let w = max(size.width, 1)
            let h = max(size.height, 1)

            let shape: AnyShape = (mode == "textStroked")
                ? AnyShape(StrokedTextShape(attributedString: attr, lineWidth: max(model.fontSize * 0.08, 2)))
                : AnyShape(textShape)

            glassified(anyShape: shape, frameSize: CGSize(width: w, height: h), suppressTint: false)
                .frame(width: w, height: h)
                .accessibilityLabel(model.text)
        }
    }

    private func resolveDebugShape(_ mode: String) -> AnyShape {
        switch mode {
        case "square":       return AnyShape(DebugSquareShape())
        case "circle":       return AnyShape(Circle())
        case "capsule":      return AnyShape(Capsule())
        case "roundedRect":  return AnyShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        default:             return AnyShape(DebugSquareShape())
        }
    }

    @ViewBuilder
    private func glassified(anyShape: AnyShape, frameSize: CGSize, suppressTint: Bool) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *),
           NSClassFromString("UIGlassEffect") != nil {
            GlassEffectContainer(spacing: 0) {
                // Near-clear color instead of Color.clear: SwiftUI elides
                // pure clear views from the render tree, leaving no host for glass.
                // Use Color(white:opacity:) — Color.white.opacity(_:) is ambiguous
                // under the iOS 26.2 SDK (resolves to ShapeStyle, not View).
                Color(white: 1.0, opacity: 0.001)
                    .frame(width: frameSize.width, height: frameSize.height)
                    .glassEffect(resolvedGlass(suppressTint: suppressTint), in: anyShape)
            }
        } else {
            nativeFallback()
        }
        #else
        nativeFallback()
        #endif
    }

    #if compiler(>=6.2)
    @available(iOS 26.0, *)
    private func resolvedGlass(suppressTint: Bool) -> Glass {
        // `suppressTint` is used for debug shapes where we want to see pure
        // glass without the text foreground bleeding through as a tint.
        // The glassVariant prop is always respected so callers can cycle
        // between `.clear` and `.regular` from JS.
        var g: Glass = (model.glassVariant == "clear") ? .clear : .regular
        if !suppressTint, let tint = model.tint { g = g.tint(Color(tint)) }
        if model.interactive { g = g.interactive(true) }
        return g
    }
    #endif

    // Rendered when the module is loaded on a pre-iOS-26 OS or early-beta
    // iOS 26 without UIGlassEffect. JS side also checks isSupported and falls
    // back to <Text>, so this path is reached only when the native view is
    // instantiated anyway — keep it visible so the balance doesn't disappear.
    @ViewBuilder
    private func nativeFallback() -> some View {
        Text(AttributedString(model.buildAttributedString()))
            .foregroundStyle(Color(model.tint ?? .label))
    }
}
