import ExpoModulesCore
import SwiftUI
import UIKit

// Parallel to `LiquidGlassTextView` in the sibling `liquid-glass-text` module.
// Hosts the upstream `UpstreamLiquidGlassTextSwiftUI` view for A/B comparison.
public final class LiquidGlassTextUpstreamView: ExpoView {
    let onLayout = EventDispatcher()

    private var _model: Any?
    private var hostingController: UIViewController?

    @available(iOS 17.0, *)
    var model: UpstreamLiquidGlassTextModel {
        if let m = _model as? UpstreamLiquidGlassTextModel { return m }
        let m = UpstreamLiquidGlassTextModel()
        _model = m
        return m
    }

    public required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .clear
        clipsToBounds = false
        mount()
    }

    private func mount() {
        guard #available(iOS 17.0, *) else {
            mountLegacyFallback()
            return
        }
        let root = UpstreamLiquidGlassTextRoot(model: model)
        let hc = UIHostingController(rootView: root)
        hc.view.backgroundColor = .clear
        hc.sizingOptions = [.intrinsicContentSize]
        hc.view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(hc.view)
        NSLayoutConstraint.activate([
            hc.view.topAnchor.constraint(equalTo: topAnchor),
            hc.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            hc.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            hc.view.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        hostingController = hc
    }

    private func mountLegacyFallback() {
        let label = UILabel(frame: bounds)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        label.numberOfLines = 0
        label.textAlignment = .center
        addSubview(label)
    }

    public override var intrinsicContentSize: CGSize {
        hostingController?.view.intrinsicContentSize ?? super.intrinsicContentSize
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        onLayout(["width": bounds.width, "height": bounds.height])
    }

    func invalidateSize() {
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    // MARK: - helpers

    static func uiWeight(from s: String) -> UIFont.Weight {
        switch s {
        case "ultraLight": return .ultraLight
        case "thin":       return .thin
        case "light":      return .light
        case "regular":    return .regular
        case "medium":     return .medium
        case "semibold":   return .semibold
        case "bold":       return .bold
        case "heavy":      return .heavy
        case "black":      return .black
        default:           return .regular
        }
    }

    // Accepts `#RRGGBB` or `#RRGGBBAA` (mirrors the sibling liquid-glass-text
    // module). 8-char form carries an explicit alpha so callers can tint with
    // a translucent colour (e.g. a dim white).
    static func color(hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard let v = UInt32(s, radix: 16) else { return nil }
        switch s.count {
        case 6:
            return UIColor(
                red:   CGFloat((v & 0xFF0000) >> 16) / 255,
                green: CGFloat((v & 0x00FF00) >> 8)  / 255,
                blue:  CGFloat( v & 0x0000FF)        / 255,
                alpha: 1
            )
        case 8:
            return UIColor(
                red:   CGFloat((v & 0xFF000000) >> 24) / 255,
                green: CGFloat((v & 0x00FF0000) >> 16) / 255,
                blue:  CGFloat((v & 0x0000FF00) >> 8)  / 255,
                alpha: CGFloat( v & 0x000000FF)        / 255
            )
        default:
            return nil
        }
    }
}
