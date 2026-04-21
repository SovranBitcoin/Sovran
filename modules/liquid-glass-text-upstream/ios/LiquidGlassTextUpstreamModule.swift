import ExpoModulesCore
import UIKit

public class LiquidGlassTextUpstreamModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiquidGlassTextUpstream")

        Constant("isSupported") {
            LiquidGlassTextUpstreamModule.isSupported
        }

        Function("isLiquidGlassAvailable") {
            return LiquidGlassTextUpstreamModule.isSupported
        }

        View(LiquidGlassTextUpstreamView.self) {
            Events("onLayout")

            Prop("text") { (view: LiquidGlassTextUpstreamView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.text = value
                view.invalidateSize()
            }
            Prop("fontName") { (view: LiquidGlassTextUpstreamView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontName = value
                view.invalidateSize()
            }
            Prop("fontSize") { (view: LiquidGlassTextUpstreamView, value: Double) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontSize = CGFloat(value)
                view.invalidateSize()
            }
            Prop("fontWeight") { (view: LiquidGlassTextUpstreamView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.fontWeight = LiquidGlassTextUpstreamView.uiWeight(from: value)
                view.invalidateSize()
            }
            Prop("tint") { (view: LiquidGlassTextUpstreamView, value: String?) in
                guard #available(iOS 17.0, *) else { return }
                view.model.tint = value.flatMap { LiquidGlassTextUpstreamView.color(hex: $0) }
            }
            Prop("glassVariant") { (view: LiquidGlassTextUpstreamView, value: String) in
                guard #available(iOS 17.0, *) else { return }
                view.model.glassVariant = value
            }
            Prop("interactive") { (view: LiquidGlassTextUpstreamView, value: Bool) in
                guard #available(iOS 17.0, *) else { return }
                view.model.interactive = value
            }
        }
    }

    static var isSupported: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            return NSClassFromString("UIGlassEffect") != nil
        }
        #endif
        return false
    }
}
