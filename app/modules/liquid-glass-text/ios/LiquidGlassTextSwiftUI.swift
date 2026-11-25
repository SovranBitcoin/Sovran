import SwiftUI
import CoreText
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
    /// Roll changed digits instead of swapping the whole glyph shape.
    var animated: Bool = false
    /// The value behind `text`; its change decides the roll direction.
    var numericValue: Double = 0
    /// Changes when the same value is re-read another way (BTC ↔ sats): snap.
    var formatKey: String = ""

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
        } else if mode == "none" && model.animated && Self.rollingGlassAvailable {
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                RollingGlassAmount(model: model, glass: resolvedGlass(suppressTint: false))
            }
            #endif
        } else if mode == "none" && model.animated {
            nativeFallback()
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

    private static var rollingGlassAvailable: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return NSClassFromString("UIGlassEffect") != nil }
        #endif
        return false
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
        NumericFallbackText(model: model)
    }
}

/// Plain text that counts its digits to the new value (`.numericText`) when
/// the amount changes, and swaps instantly on mount, on a `formatKey` change
/// and under Reduce Motion.
@available(iOS 17.0, *)
private struct NumericFallbackText: View {
    @Bindable var model: LiquidGlassTextModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: AttributedString? = nil
    @State private var shownValue: Double = 0
    @State private var shownFormatKey: String = ""

    var body: some View {
        Text(shown ?? AttributedString(model.buildAttributedString()))
            .foregroundStyle(Color(model.tint ?? .label))
            .contentTransition(.numericText(value: shownValue))
            .accessibilityLabel(model.text)
            .onAppear { snap() }
            .onChange(of: model.text) { _, _ in update() }
            .onChange(of: model.formatKey) { _, _ in update() }
    }

    private func snap() {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            shown = AttributedString(model.buildAttributedString())
            shownValue = model.numericValue
            shownFormatKey = model.formatKey
        }
    }

    private func update() {
        guard model.animated, !reduceMotion, shownFormatKey == model.formatKey else {
            snap()
            return
        }
        withAnimation(.spring(duration: 0.36, bounce: 0.1)) {
            shown = AttributedString(model.buildAttributedString())
            shownValue = model.numericValue
        }
    }
}

// MARK: - Rolling amount (iOS 26 Liquid Glass)

/// One position of a formatted amount. Mirrors `tokenizeAmount` in
/// `app/shared/lib/amountSlots.ts`: integer digits are keyed from the least
/// significant (`int-0` = ones), fraction digits from the decimal point
/// (`frac-0`), and every other character by the digit beside it, so a slot
/// keeps its identity while the value changes.
struct AmountSlot: Equatable {
    let id: String
    let char: String
    /// 0–9 for a digit slot, nil for a static one (sign, separator, unit).
    let digit: Int?
}

enum AmountSlots {
    static func tokenize(_ text: String, decimalSeparator: Character = ".") -> [AmountSlot] {
        let chars = Array(text).map { String($0) }
        let isDigit: (String) -> Bool = { $0.count == 1 && ("0"..."9").contains($0) }
        guard let first = chars.firstIndex(where: isDigit),
              let last = chars.lastIndex(where: isDigit) else {
            return chars.enumerated().map { i, c in
                AmountSlot(id: "pre-\(chars.count - 1 - i)", char: c, digit: nil)
            }
        }
        var point = -1
        if last > first {
            for i in stride(from: last, to: first, by: -1) where chars[i] == String(decimalSeparator) {
                point = i
                break
            }
        }
        let integerEnd = point == -1 ? last : point - 1

        var intIndex: [Int: Int] = [:]
        var intRight: [Int: Int] = [:]
        var digitsRight = 0
        for i in stride(from: integerEnd, through: first, by: -1) {
            intRight[i] = digitsRight
            if isDigit(chars[i]) {
                intIndex[i] = digitsRight
                digitsRight += 1
            }
        }

        var out: [AmountSlot] = []
        var fracLeft = 0
        for (i, c) in chars.enumerated() {
            if i < first {
                out.append(AmountSlot(id: "pre-\(first - 1 - i)", char: c, digit: nil))
            } else if i > last {
                out.append(AmountSlot(id: "suf-\(i - last - 1)", char: c, digit: nil))
            } else if i <= integerEnd {
                if let n = intIndex[i] {
                    out.append(AmountSlot(id: "int-\(n)", char: c, digit: Int(c)))
                } else {
                    out.append(AmountSlot(id: "isep-\(intRight[i] ?? 0)", char: c, digit: nil))
                }
            } else if i == point {
                out.append(AmountSlot(id: "point", char: c, digit: nil))
            } else if isDigit(c) {
                out.append(AmountSlot(id: "frac-\(fracLeft)", char: c, digit: Int(c)))
                fracLeft += 1
            } else {
                out.append(AmountSlot(id: "fsep-\(fracLeft)", char: c, digit: nil))
            }
        }
        return out
    }
}

/// Baseline-anchored glyph outlines for one font, so every slot of an amount
/// shares a line box (TextShape fits each string to its ink bounds, which
/// would set a comma and a 7 at different heights).
private final class GlyphOutlines: @unchecked Sendable {
    private static let lock = NSLock()
    private static var cache: [String: GlyphOutlines] = [:]

    static func forFont(_ font: UIFont) -> GlyphOutlines {
        let key = "\(font.fontName)@\(font.pointSize)"
        lock.lock(); defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        if cache.count > 16 { cache.removeAll() }
        let made = GlyphOutlines(font: font)
        cache[key] = made
        return made
    }

    let font: UIFont
    /// Ascender to descender: the height every slot is laid out in.
    let lineHeight: CGFloat
    /// Widest of 0–9: every digit column is this wide, so a roll never
    /// changes the amount's width.
    let digitWidth: CGFloat
    private var glyphs: [String: (path: Path, advance: CGFloat)] = [:]
    private let glyphLock = NSLock()

    private init(font: UIFont) {
        self.font = font
        self.lineHeight = ceil(font.ascender - font.descender)
        var widest: CGFloat = 0
        var seeded: [String: (path: Path, advance: CGFloat)] = [:]
        for d in 0...9 {
            let g = GlyphOutlines.build(String(d), font: font)
            seeded[String(d)] = g
            widest = max(widest, g.advance)
        }
        self.digitWidth = ceil(widest)
        self.glyphs = seeded
    }

    /// The outline of `char` with its origin at the left of its advance and
    /// the top of the line box (SwiftUI's y-down space).
    func glyph(_ char: String) -> (path: Path, advance: CGFloat) {
        glyphLock.lock(); defer { glyphLock.unlock() }
        if let hit = glyphs[char] { return hit }
        let g = GlyphOutlines.build(char, font: font)
        glyphs[char] = g
        return g
    }

    private static func build(_ char: String, font: UIFont) -> (path: Path, advance: CGFloat) {
        let attr = NSAttributedString(string: char, attributes: [.font: font])
        let line = CTLineCreateWithAttributedString(attr as CFAttributedString)
        let advance = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let mutable = CGMutablePath()
        if let runs = CTLineGetGlyphRuns(line) as? [CTRun] {
            for run in runs {
                let attrs = CTRunGetAttributes(run) as NSDictionary
                guard let rawFont = attrs[kCTFontAttributeName as String] else { continue }
                let ctFont = rawFont as! CTFont
                let count = CTRunGetGlyphCount(run)
                guard count > 0 else { continue }
                var ids = [CGGlyph](repeating: 0, count: count)
                var positions = [CGPoint](repeating: .zero, count: count)
                CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &ids)
                CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
                for k in 0..<count {
                    guard let gp = CTFontCreatePathForGlyph(ctFont, ids[k], nil) else { continue }
                    // CoreText is y-up from the baseline; flip into y-down with
                    // the baseline `ascender` below the top of the line box.
                    let t = CGAffineTransform(a: 1, b: 0, c: 0, d: -1,
                                              tx: positions[k].x,
                                              ty: font.ascender - positions[k].y)
                    mutable.addPath(gp, transform: t)
                }
            }
        }
        return (Path(mutable), advance)
    }
}

/// One slot's glyph, rolling from `from` to `to` inside its own rect: the old
/// digit leaves through one edge while the new one enters from the other, and
/// both are cut to the slot so nothing spills past the line. `progress`
/// animates (0 = start of roll, 1 = settled).
private struct RollingGlyphShape: Shape {
    let outlines: GlyphOutlines
    let from: String?
    let to: String
    /// 1 = the value grew (glyphs move up), -1 = it shrank (down).
    let direction: CGFloat
    var progress: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let h = rect.height
        func placed(_ char: String, dy: CGFloat) -> Path {
            let g = outlines.glyph(char)
            let dx = rect.minX + (rect.width - g.advance) / 2
            return g.path.offsetBy(dx: dx, dy: rect.minY + dy)
        }
        guard let from, progress < 1 else {
            return placed(to, dy: 0)
        }
        var p = Path()
        p.addPath(placed(from, dy: -direction * h * progress))
        p.addPath(placed(to, dy: direction * h * (1 - progress)))
        return p.intersection(Path(rect))
    }
}

/// What a slot shows: the digit it settled on, the one rolling out, and a
/// token that restarts the roll each time the digit changes.
private struct ShownSlot: Equatable {
    let slot: AmountSlot
    var previous: String?
    var direction: CGFloat
    var rollId: Int
}

/// The amount as one glass cutout per slot inside a single
/// `GlassEffectContainer`: digits sit in fixed tabular columns and only the
/// ones that change roll; the sign, separators and unit glyph stay still.
#if compiler(>=6.2)
@available(iOS 26.0, *)
private struct RollingGlassAmount: View {
    @Bindable var model: LiquidGlassTextModel
    let glass: Glass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: [ShownSlot] = []
    @State private var shownValue: Double = 0
    @State private var shownFormatKey: String = ""
    @State private var mounted = false

    var body: some View {
        let outlines = GlyphOutlines.forFont(model.resolvedFont())
        let slots = mounted ? shown : Self.snapped(model.text)
        GlassEffectContainer(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(slots, id: \.slot.id) { item in
                    slotView(item, outlines: outlines)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.text)
        .onAppear {
            shown = Self.snapped(model.text)
            shownValue = model.numericValue
            shownFormatKey = model.formatKey
            mounted = true
        }
        .onChange(of: model.text) { _, _ in update() }
        .onChange(of: model.formatKey) { _, _ in update() }
    }

    @ViewBuilder
    private func slotView(_ item: ShownSlot, outlines: GlyphOutlines) -> some View {
        let width = item.slot.digit != nil
            ? outlines.digitWidth
            : ceil(outlines.glyph(item.slot.char).advance)
        // Near-clear host, as in the single-shape path: SwiftUI elides pure
        // clear views, which would leave the glass nothing to attach to.
        Color(white: 1.0, opacity: 0.001)
            .frame(width: max(width, 1), height: max(outlines.lineHeight, 1))
            .keyframeAnimator(initialValue: CGFloat(1), trigger: item.rollId) { content, progress in
                content.glassEffect(glass, in: RollingGlyphShape(
                    outlines: outlines,
                    from: item.previous,
                    to: item.slot.char,
                    direction: item.direction,
                    progress: progress
                ))
            } keyframes: { _ in
                KeyframeTrack {
                    MoveKeyframe(CGFloat(0))
                    SpringKeyframe(CGFloat(1), duration: 0.36, spring: .init(duration: 0.36, bounce: 0.1))
                }
            }
    }

    private static func snapped(_ text: String) -> [ShownSlot] {
        AmountSlots.tokenize(text).map { ShownSlot(slot: $0, previous: nil, direction: 1, rollId: 0) }
    }

    private func update() {
        let next = AmountSlots.tokenize(model.text)
        let snap = reduceMotion || shownFormatKey != model.formatKey
        let valueDirection: CGFloat? = model.numericValue == shownValue
            ? nil
            : (model.numericValue > shownValue ? 1 : -1)
        let old = Dictionary(shown.map { ($0.slot.id, $0) }, uniquingKeysWith: { a, _ in a })

        let updated: [ShownSlot] = next.map { slot in
            guard let before = old[slot.id] else {
                return ShownSlot(slot: slot, previous: nil, direction: 1, rollId: 0)
            }
            if snap {
                return ShownSlot(slot: slot, previous: nil, direction: 1, rollId: before.rollId)
            }
            guard let digit = slot.digit, let was = before.slot.digit, digit != was else {
                // Unchanged: keep any roll still in flight as it is.
                return ShownSlot(slot: slot, previous: before.previous,
                                 direction: before.direction, rollId: before.rollId)
            }
            let direction = valueDirection ?? (digit > was ? 1 : -1)
            return ShownSlot(slot: slot, previous: before.slot.char,
                             direction: direction, rollId: before.rollId + 1)
        }
        shown = updated
        shownValue = model.numericValue
        shownFormatKey = model.formatKey
    }
}
#endif
