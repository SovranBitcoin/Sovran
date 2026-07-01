import WidgetKit
import SwiftUI

// MARK: - Provider

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
        completion(SimpleEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [SimpleEntry(date: Date())], policy: .never))
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
}

// MARK: - Color

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    static let bitcoinOrange = Color(hex: 0xF7931A)
    static let bitcoinOrangeDark = Color(hex: 0xDE7C0A)
}

// MARK: - Logo Shapes

struct BitcoinLogo: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let dx = (rect.width - 24 * s) / 2
        let dy = (rect.height - 24 * s) / 2

        func p(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: x * s + dx, y: y * s + dy)
        }

        var path = Path()

        path.move(to: p(13.52, 13.67))
        path.addCurve(to: p(10.82, 14.02), control1: p(13.25, 14.76), control2: p(11.42, 14.17))
        path.addLine(to: p(11.3, 12.09))
        path.addCurve(to: p(13.52, 13.67), control1: p(11.9, 12.24), control2: p(13.8, 12.53))
        path.closeSubpath()

        path.move(to: p(11.96, 9.45))
        path.addLine(to: p(11.52, 11.2))
        path.addCurve(to: p(13.8, 10.84), control1: p(12.02, 11.32), control2: p(13.55, 11.83))
        path.addCurve(to: p(11.96, 9.45), control1: p(14.05, 9.81), control2: p(12.46, 9.57))
        path.closeSubpath()

        path.move(to: p(19.76, 13.93))
        path.addCurve(to: p(10.06, 19.76), control1: p(18.69, 18.21), control2: p(14.35, 20.82))
        path.addCurve(to: p(4.23, 10.07), control1: p(5.78, 18.69), control2: p(3.16, 14.35))
        path.addCurve(to: p(13.93, 4.24), control1: p(5.3, 5.78), control2: p(9.64, 3.18))
        path.addCurve(to: p(19.76, 13.93), control1: p(18.21, 5.31), control2: p(20.83, 9.65))
        path.closeSubpath()

        path.move(to: p(9.37, 13.34))
        path.addCurve(to: p(8.97, 13.55), control1: p(9.33, 13.45), control2: p(9.22, 13.61))
        path.addCurve(to: p(8.33, 13.39), control1: p(8.93, 13.55), control2: p(8.33, 13.39))
        path.addLine(to: p(7.89, 14.39))
        path.addLine(to: p(9.03, 14.67))
        path.addCurve(to: p(9.66, 14.84), control1: p(9.25, 14.73), control2: p(9.45, 14.78))
        path.addLine(to: p(9.3, 16.29))
        path.addLine(to: p(10.17, 16.51))
        path.addLine(to: p(10.53, 15.07))
        path.addCurve(to: p(11.23, 15.25), control1: p(10.77, 15.14), control2: p(11.0, 15.19))
        path.addLine(to: p(10.87, 16.68))
        path.addLine(to: p(11.75, 16.9))
        path.addLine(to: p(12.11, 15.45))
        path.addCurve(to: p(15.21, 14.26), control1: p(13.61, 15.73), control2: p(14.74, 15.62))
        path.addCurve(to: p(14.4, 12.13), control1: p(15.59, 13.17), control2: p(15.19, 12.54))
        path.addCurve(to: p(15.52, 10.84), control1: p(14.97, 12.0), control2: p(15.4, 11.62))
        path.addCurve(to: p(13.76, 8.83), control1: p(15.68, 9.78), control2: p(14.87, 9.2))
        path.addLine(to: p(14.12, 7.38))
        path.addLine(to: p(13.24, 7.16))
        path.addLine(to: p(12.89, 8.56))
        path.addCurve(to: p(12.18, 8.39), control1: p(12.66, 8.5), control2: p(12.42, 8.45))
        path.addLine(to: p(12.53, 6.98))
        path.addLine(to: p(11.66, 6.76))
        path.addLine(to: p(11.3, 8.2))
        path.addCurve(to: p(10.74, 8.07), control1: p(11.11, 8.16), control2: p(10.92, 8.11))
        path.addLine(to: p(9.53, 7.76))
        path.addLine(to: p(9.3, 8.7))
        path.addCurve(to: p(9.94, 8.86), control1: p(9.3, 8.7), control2: p(9.94, 8.85))
        path.addCurve(to: p(10.35, 9.37), control1: p(10.29, 8.95), control2: p(10.35, 9.18))
        path.addLine(to: p(9.36, 13.32))
        path.addLine(to: p(9.37, 13.34))
        path.closeSubpath()

        return path
    }
}

struct SovranLogo: Shape {
    // Circle + S-mark; use eoFill so the S cuts through the circle.
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 631
        let dx = (rect.width - 631 * s) / 2
        let dy = (rect.height - 631 * s) / 2

        func p(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: x * s + dx, y: y * s + dy)
        }

        var path = Path()

        // Outer circle
        let r = 315.282 * s
        let cx = 315.282 * s + dx
        let cy = 315.282 * s + dy
        path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))

        // S-mark main body
        path.move(to: p(219.746, 260.45))
        path.addCurve(to: p(321.504, 133.469), control1: p(180.994, 183.892), control2: p(264.298, 139.013))
        path.addCurve(to: p(258.758, 180.724), control1: p(321.504, 133.469), control2: p(274.385, 138.982))
        path.addCurve(to: p(330.24, 295.561), control1: p(242.154, 225.075), control2: p(279.517, 262.521))
        path.addCurve(to: p(395.577, 344.136), control1: p(353.313, 310.59), control2: p(377.914, 325.92))
        path.addCurve(to: p(392.413, 453.693), control1: p(421.675, 371.855), control2: p(431.956, 415.15))
        path.addCurve(to: p(257.175, 489.068), control1: p(357.646, 487.581), control2: p(298.313, 507.377))
        path.addCurve(to: p(210.52, 402.742), control1: p(219.214, 472.173), control2: p(201.166, 439.479))
        path.addCurve(to: p(274.579, 333.048), control1: p(223.964, 349.944), control2: p(274.579, 333.048))
        path.addCurve(to: p(244, 399.046), control1: p(245.845, 352.848), control2: p(242.81, 380.039))
        path.addCurve(to: p(276.161, 456.333), control1: p(246.167, 433.669), control2: p(276.161, 456.333))
        path.addCurve(to: p(356.829, 456.069), control1: p(306.477, 479.828), control2: p(340.748, 471.909))
        path.addCurve(to: p(368.955, 396.143), control1: p(370.01, 444.189), control2: p(380.22, 422.806))
        path.addCurve(to: p(307.795, 335.16), control1: p(363.396, 382.985), control2: p(353.665, 365.783))
        path.addCurve(to: p(219.746, 260.45), control1: p(271.68, 311.929), control2: p(234.35, 289.301))
        path.closeSubpath()

        // S-mark top curl
        path.move(to: p(353.141, 149.573))
        path.addCurve(to: p(280.909, 180.988), control1: p(315.443, 149.573), control2: p(289.081, 165.94))
        path.addCurve(to: p(351.032, 173.332), control1: p(296.199, 164.356), control2: p(327.306, 158.285))
        path.addCurve(to: p(383.721, 231.675), control1: p(374.758, 188.38), control2: p(383.721, 208.707))
        path.addCurve(to: p(354.195, 288.961), control1: p(383.721, 254.642), control2: p(378.185, 270.746))
        path.addCurve(to: p(422.473, 207.651), control1: p(398.22, 268.898), control2: p(421.946, 242.762))
        path.addCurve(to: p(353.141, 149.573), control1: p(423, 172.54), control2: p(390.838, 149.573))
        path.closeSubpath()

        return path
    }
}

// MARK: - Logo View

enum LogoBrand {
    case bitcoin
    case sovran
}

struct LogoView: View {
    let brand: LogoBrand
    let color: Color
    let size: CGFloat

    var body: some View {
        switch brand {
        case .bitcoin:
            BitcoinLogo()
                .fill(color)
                .frame(width: size, height: size)
        case .sovran:
            SovranLogo()
                .fill(color, style: FillStyle(eoFill: true))
                .frame(width: size, height: size)
        }
    }
}

// MARK: - Shared Widget Layouts

private let payURL = URL(string: "sovran://camera?action=nfc-pay")!

struct PayWidgetEntryView: View {
    var entry: Provider.Entry
    let brand: LogoBrand
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:   smallLayout
        case .systemMedium:  mediumLayout
        case .systemLarge:   largeLayout
        case .accessoryCircular:    circularLayout
        case .accessoryRectangular: rectangularLayout
        case .accessoryInline:      inlineLayout
        default: smallLayout
        }
    }

    // MARK: System (orange background, white content)

    private var smallLayout: some View {
        Link(destination: payURL) {
            VStack(spacing: 10) {
                LogoView(brand: brand, color: .white, size: 48)
                Text("Bitcoin Pay")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var mediumLayout: some View {
        Link(destination: payURL) {
            HStack(spacing: 0) {
                LogoView(brand: brand, color: .white, size: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Bitcoin Pay")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Tap to pay with NFC")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                }
                Spacer()
            }
            .padding(.leading, 2)
            .padding(.trailing, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var largeLayout: some View {
        Link(destination: payURL) {
            VStack(spacing: 20) {
                Spacer()
                LogoView(brand: brand, color: .white, size: 80)
                VStack(spacing: 6) {
                    Text("Bitcoin Pay")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Tap to pay with NFC")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Lock-screen (white bg + black content for vibrant cutout)

    private var circularLayout: some View {
        ZStack {
            Circle().fill(.white)
            LogoView(brand: brand, color: .black, size: .infinity)
                .padding(8)
        }
        .widgetURL(payURL)
    }

    private var rectangularLayout: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.white)
            HStack(spacing: 0) {
                LogoView(brand: brand, color: .black, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bitcoin Pay")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.black)
                    Text("Tap to pay")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.black.opacity(0.6))
                }
            }
        }
        .widgetURL(payURL)
    }

    private var inlineLayout: some View {
        Text("₿ Bitcoin Pay")
            .widgetURL(payURL)
    }
}

// MARK: - Widget Configurations

private let supportedFamilies: [WidgetFamily] = [
    .systemSmall,
    .systemMedium,
    .systemLarge,
    .accessoryCircular,
    .accessoryRectangular,
    .accessoryInline,
]

private var orangeGradient: LinearGradient {
    LinearGradient(
        colors: [.bitcoinOrange, .bitcoinOrangeDark],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

struct BitcoinPayWidget: Widget {
    let kind = "BitcoinPayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                PayWidgetEntryView(entry: entry, brand: .bitcoin)
                    .containerBackground(for: .widget) { orangeGradient }
            } else {
                ZStack { orangeGradient; PayWidgetEntryView(entry: entry, brand: .bitcoin) }
            }
        }
        .configurationDisplayName("Bitcoin Pay")
        .description("Tap to pay with Bitcoin over NFC.")
        .supportedFamilies(supportedFamilies)
    }
}

struct SovranPayWidget: Widget {
    let kind = "SovranPayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                PayWidgetEntryView(entry: entry, brand: .sovran)
                    .containerBackground(for: .widget) { orangeGradient }
            } else {
                ZStack { orangeGradient; PayWidgetEntryView(entry: entry, brand: .sovran) }
            }
        }
        .configurationDisplayName("Sovran Pay")
        .description("Tap to pay with Bitcoin over NFC.")
        .supportedFamilies(supportedFamilies)
    }
}
