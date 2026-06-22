import ExpoModulesCore
import UIKit

// A menu action passed from JS. Kept a flat Record so it crosses the bridge
// as a plain object array.
struct GlassMenuActionRecord: Record {
    @Field var id: String = ""
    @Field var title: String = ""
    @Field var image: String = ""
    @Field var selected: Bool = false
}

// A UIKit glass button that owns a UIMenu. Deliberately UIKit (not a SwiftUI
// UIHostingController): a plain UIView scrolls with the surrounding RN
// ScrollView, whereas a hosting controller pins to the top (expo/expo#46278).
// On iOS 26 a `.glass()` button morphs into its menu, reproducing the Liquid
// Glass context-menu animation that the SwiftUI Menu had — without the pin.
public final class LiquidGlassMenuView: ExpoView {
    let onSelectAction = EventDispatcher()
    let onPrimaryPress = EventDispatcher()

    private let button = UIButton(type: .system)

    // Model — internal so the module's Prop setters (a separate file in the
    // same Swift module) can write to them.
    var actions: [GlassMenuActionRecord] = []
    var menuTitle: String = ""
    var label: String = ""
    var labelColorHex: String?
    var labelSize: CGFloat = 14
    var subtitle: String = ""
    var imageName: String = ""
    var imageColorHex: String?
    var alignLeading: Bool = false
    var tintHex: String?
    var schemeStr: String = ""
    var hasPrimaryAction: Bool = false

    public required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .clear
        clipsToBounds = false
        button.translatesAutoresizingMaskIntoConstraints = false
        addSubview(button)
        NSLayoutConstraint.activate([
            button.topAnchor.constraint(equalTo: topAnchor),
            button.leadingAnchor.constraint(equalTo: leadingAnchor),
            button.trailingAnchor.constraint(equalTo: trailingAnchor),
            button.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        button.addTarget(self, action: #selector(handlePrimaryTap), for: .touchUpInside)
    }

    @objc private func handlePrimaryTap() {
        // .touchUpInside only fires when the menu is NOT the primary action.
        if hasPrimaryAction {
            onPrimaryPress([:])
        }
    }

    // Rebuild the button's configuration + menu. Cheap; called whenever a prop
    // changes (a handful of times per mount).
    func apply() {
        var config: UIButton.Configuration
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), NSClassFromString("UIGlassEffect") != nil {
            config = .glass()
        } else {
            config = .plain()
        }
        #else
        config = .plain()
        #endif

        let color = labelColorHex.flatMap { Self.color(hex: $0) } ?? .label
        var container = AttributeContainer()
        container.font = UIFont.systemFont(ofSize: labelSize, weight: .bold)
        container.foregroundColor = color
        config.attributedTitle = AttributedString(label, attributes: container)

        // Optional second line, rendered regular weight a couple points down.
        if subtitle.isEmpty {
            config.attributedSubtitle = nil
        } else {
            var sub = AttributeContainer()
            sub.font = UIFont.systemFont(ofSize: max(11, labelSize - 6), weight: .regular)
            sub.foregroundColor = color
            config.attributedSubtitle = AttributedString(subtitle, attributes: sub)
            config.titleAlignment = .leading
        }

        // Optional leading SF Symbol, tinted via a color transformer so it keeps
        // its own colour through the glass rather than inheriting the label tint.
        if imageName.isEmpty {
            config.image = nil
        } else {
            config.image = UIImage(systemName: imageName)
            config.imagePlacement = .leading
            config.imagePadding = 10
            let imageColor = imageColorHex.flatMap { Self.color(hex: $0) } ?? color
            config.imageColorTransformer = UIConfigurationColorTransformer { _ in imageColor }
        }

        config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)
        if let tint = tintHex.flatMap({ Self.color(hex: $0) }) {
            config.baseBackgroundColor = tint
        }
        button.configuration = config

        // Left-align the whole content (icon + text) for the wider map card; the
        // currency pill keeps the default centred layout.
        button.contentHorizontalAlignment = alignLeading ? .leading : .center

        overrideUserInterfaceStyle =
            schemeStr == "dark" ? .dark : (schemeStr == "light" ? .light : .unspecified)

        rebuildMenu()
    }

    private func rebuildMenu() {
        let children: [UIMenuElement] = actions.map { action in
            let image = action.image.isEmpty ? nil : UIImage(systemName: action.image)
            let id = action.id
            return UIAction(
                title: action.title,
                image: image,
                state: action.selected ? .on : .off
            ) { [weak self] _ in
                self?.onSelectAction(["id": id])
            }
        }
        button.menu = UIMenu(title: menuTitle, children: children)
        // Primary-action tap opens (and morphs) the menu; with a JS tap handler
        // the menu falls back to long-press so the tap can fire onPrimaryPress.
        button.showsMenuAsPrimaryAction = !hasPrimaryAction
    }

    // Accepts `#RRGGBB` or `#RRGGBBAA` (the 8-char form carries alpha, e.g. a
    // dim white glass tint from `opacity('#FFFFFF', 0.15)` on the JS side).
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
