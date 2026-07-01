import ExpoModulesCore
import UIKit

public class LiquidGlassMenuModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiquidGlassMenu")

        Constants([
            "isSupported": LiquidGlassMenuModule.isSupported
        ])

        View(LiquidGlassMenuView.self) {
            Events("onSelectAction", "onPrimaryPress")

            Prop("label") { (view: LiquidGlassMenuView, value: String) in
                view.label = value
                view.apply()
            }
            Prop("labelColor") { (view: LiquidGlassMenuView, value: String?) in
                view.labelColorHex = value
                view.apply()
            }
            Prop("labelSize") { (view: LiquidGlassMenuView, value: Double) in
                view.labelSize = CGFloat(value)
                view.apply()
            }
            Prop("subtitle") { (view: LiquidGlassMenuView, value: String?) in
                view.subtitle = value ?? ""
                view.apply()
            }
            Prop("image") { (view: LiquidGlassMenuView, value: String?) in
                view.imageName = value ?? ""
                view.apply()
            }
            Prop("imageColor") { (view: LiquidGlassMenuView, value: String?) in
                view.imageColorHex = value
                view.apply()
            }
            Prop("contentAlignment") { (view: LiquidGlassMenuView, value: String?) in
                view.alignLeading = value == "leading"
                view.apply()
            }
            Prop("tint") { (view: LiquidGlassMenuView, value: String?) in
                view.tintHex = value
                view.apply()
            }
            Prop("colorScheme") { (view: LiquidGlassMenuView, value: String?) in
                view.schemeStr = value ?? ""
                view.apply()
            }
            Prop("menuTitle") { (view: LiquidGlassMenuView, value: String) in
                view.menuTitle = value
                view.apply()
            }
            Prop("hasPrimaryAction") { (view: LiquidGlassMenuView, value: Bool) in
                view.hasPrimaryAction = value
                view.apply()
            }
            Prop("actions") { (view: LiquidGlassMenuView, value: [GlassMenuActionRecord]) in
                view.actions = value
                view.apply()
            }
        }
    }

    static var isSupported: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            // Early iOS 26 betas shipped without the UIGlassEffect symbol
            // (expo/expo #40911). Probe for the class before reporting support.
            return NSClassFromString("UIGlassEffect") != nil
        }
        #endif
        return false
    }
}
