import SwiftUI
import CoreText
import UIKit

private struct TextShapeCacheKey: Hashable {
    let string: String
    let fontName: String
    let fontSize: CGFloat
    let maxWidth: CGFloat
}

private enum TextShapeCache {
    static let lock = NSLock()
    static var store: [TextShapeCacheKey: Path] = [:]
    static let maxCount = 256
}

struct TextShape: Shape, Equatable {
    let attributedString: NSAttributedString
    let maxWidth: CGFloat
    let alignment: Alignment

    init(_ attributed: NSAttributedString,
         maxWidth: CGFloat = .infinity,
         alignment: Alignment = .center) {
        self.attributedString = attributed
        self.maxWidth = maxWidth
        self.alignment = alignment
    }

    static func == (lhs: TextShape, rhs: TextShape) -> Bool {
        lhs.attributedString.isEqual(to: rhs.attributedString) &&
        lhs.maxWidth == rhs.maxWidth &&
        lhs.alignment == rhs.alignment
    }

    func path(in rect: CGRect) -> Path {
        let raw = Self.buildOrFetchPath(for: attributedString, maxWidth: maxWidth)
        guard !raw.isEmpty else { return Path() }

        let b = raw.boundingRect
        let dx: CGFloat = {
            switch alignment.horizontal {
            case .leading:  return -b.minX
            case .trailing: return rect.width - b.maxX
            default:        return (rect.width  - b.width)  / 2 - b.minX
            }
        }()
        let dy: CGFloat = {
            switch alignment.vertical {
            case .top:      return -b.minY
            case .bottom:   return rect.height - b.maxY
            default:        return (rect.height - b.height) / 2 - b.minY
            }
        }()
        return raw.applying(CGAffineTransform(translationX: dx, y: dy))
    }

    func sizeThatFits(_ proposal: ProposedViewSize) -> CGSize {
        Self.buildOrFetchPath(for: attributedString, maxWidth: maxWidth).boundingRect.size
    }

    // MARK: - Pipeline

    fileprivate static func buildOrFetchPath(for attr: NSAttributedString,
                                             maxWidth: CGFloat) -> Path {
        let firstFont = attr.length > 0
            ? (attr.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
            : nil
        let key = TextShapeCacheKey(
            string: attr.string,
            fontName: firstFont?.fontName ?? "System",
            fontSize: firstFont?.pointSize ?? 0,
            maxWidth: maxWidth
        )
        TextShapeCache.lock.lock()
        if let hit = TextShapeCache.store[key] {
            TextShapeCache.lock.unlock(); return hit
        }
        TextShapeCache.lock.unlock()

        let path = buildPath(for: attr, maxWidth: maxWidth)

        TextShapeCache.lock.lock()
        if TextShapeCache.store.count > TextShapeCache.maxCount {
            TextShapeCache.store.removeAll(keepingCapacity: true)
        }
        TextShapeCache.store[key] = path
        TextShapeCache.lock.unlock()
        return path
    }

    fileprivate static func buildPath(for attr: NSAttributedString,
                                      maxWidth: CGFloat) -> Path {
        guard attr.length > 0 else { return Path() }

        let mutable = CGMutablePath()
        // Finite layout bounds — .greatestFiniteMagnitude (3.4e+38) destroys
        // glyph-level precision once CoreText translates line origins by that
        // amount, collapsing the resulting path to zero size.
        let layoutWidth: CGFloat = maxWidth.isFinite ? maxWidth : 10_000
        let layoutHeight: CGFloat = 10_000

        let framesetter = CTFramesetterCreateWithAttributedString(attr as CFAttributedString)
        let frameRect   = CGRect(x: 0, y: 0, width: layoutWidth, height: layoutHeight)
        let framePath   = CGPath(rect: frameRect, transform: nil)
        let ctFrame     = CTFramesetterCreateFrame(framesetter,
                                                   CFRange(location: 0, length: 0),
                                                   framePath, nil)

        let linesCF = CTFrameGetLines(ctFrame)
        let lineCount = CFArrayGetCount(linesCF)
        guard lineCount > 0 else { return Path() }

        var origins = [CGPoint](repeating: .zero, count: lineCount)
        CTFrameGetLineOrigins(ctFrame, CFRange(location: 0, length: 0), &origins)

        for i in 0..<lineCount {
            let line = unsafeBitCast(CFArrayGetValueAtIndex(linesCF, i), to: CTLine.self)
            let lineOrigin = origins[i]

            guard let runs = CTLineGetGlyphRuns(line) as? [CTRun] else { continue }

            for run in runs {
                let attrs = CTRunGetAttributes(run) as NSDictionary
                guard let rawFont = attrs[kCTFontAttributeName as String] else { continue }
                let ctFont = rawFont as! CTFont

                let glyphCount = CTRunGetGlyphCount(run)
                guard glyphCount > 0 else { continue }

                var glyphs    = [CGGlyph](repeating: 0,    count: glyphCount)
                var positions = [CGPoint](repeating: .zero, count: glyphCount)
                CTRunGetGlyphs(run,    CFRange(location: 0, length: 0), &glyphs)
                CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)

                for k in 0..<glyphCount {
                    guard let gp = CTFontCreatePathForGlyph(ctFont, glyphs[k], nil) else { continue }
                    let t = CGAffineTransform(
                        translationX: lineOrigin.x + positions[k].x,
                        y:            lineOrigin.y + positions[k].y
                    )
                    mutable.addPath(gp, transform: t)
                }
            }
        }

        let swift = Path(mutable)
        let b = swift.boundingRect
        guard !b.isEmpty else { return Path() }

        let normalized = swift.applying(CGAffineTransform(translationX: -b.minX, y: -b.minY))
        let flipped    = normalized.applying(
            CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -normalized.boundingRect.height)
        )
        return flipped
    }
}
