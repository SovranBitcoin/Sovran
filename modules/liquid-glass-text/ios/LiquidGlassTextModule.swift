import ExpoModulesCore
import UIKit

public class LiquidGlassTextModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiquidGlassText")

        Constants([
            "isSupported": LiquidGlassTextModule.isSupported
        ])

        Function("isLiquidGlassAvailable") {
            return LiquidGlassTextModule.isSupported
        }

        View(LiquidGlassTextView.self) {
            Events("onLayout")

            Prop("text") { (view: LiquidGlassTextView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.text = value
                view.invalidateSize()
            }
            Prop("fontName") { (view: LiquidGlassTextView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontName = value
                view.invalidateSize()
            }
            Prop("fontSize") { (view: LiquidGlassTextView, value: Double) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontSize = CGFloat(value)
                view.invalidateSize()
            }
            Prop("fontWeight") { (view: LiquidGlassTextView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontWeight = LiquidGlassTextView.uiWeight(from: value)
                view.invalidateSize()
            }
            Prop("tint") { (view: LiquidGlassTextView, value: String?) in
                guard #available(iOS 17.0, *) else { return }
                view.model.tint = value.flatMap { LiquidGlassTextView.color(hex: $0) }
            }
            Prop("glassVariant") { (view: LiquidGlassTextView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.glassVariant = value
            }
            Prop("interactive") { (view: LiquidGlassTextView, value: Bool) in
                guard #available(iOS 17.0, *) else { return }
                view.model.interactive = value
            }
            Prop("colorScheme") { (view: LiquidGlassTextView, value: String?) in
                guard #available(iOS 17.0, *) else { return }
                view.model.colorScheme = value ?? ""
            }
            Prop("debugShape") { (view: LiquidGlassTextView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.debugShape = value
                view.invalidateSize()
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
