//
//  TextHelper.swift
//  LiquidGlassText
//
//  Created by Daniel Crompton on 9/6/25.
//

import SwiftUI
import CoreText


struct UpstreamTextHelper {
    private init() { }
    
    static func path(for string: NSAttributedString) -> Path {
        let line = CTLineCreateWithAttributedString(string)
        let runs = CTLineGetGlyphRuns(line) as NSArray
        
        let outputPath = CGMutablePath()
        
        for i in 0..<CFArrayGetCount(runs) {
            let run = unsafeBitCast(CFArrayGetValueAtIndex(runs, i), to: CTRun.self)
            let attributes = CTRunGetAttributes(run) as NSDictionary
            // This conditional downcast will always succeed if the key is present, as CTFont is toll-free bridged.
            // The as? avoids a crash if the attribute is missing; the warning can be ignored.
            let key = kCTFontAttributeName as NSAttributedString.Key
            guard let anyCTFont = attributes[key] else {
                print("[LiquidGlassText] Missing font attribute in run attributes: \(attributes)")
                continue
            }
            let ctFont = anyCTFont as! CTFont
            
            let glyphCount = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: glyphCount)
            var positions = [CGPoint](repeating: .zero, count: glyphCount)
            
            CTRunGetGlyphs(run, CFRangeMake(0, 0), &glyphs)
            CTRunGetPositions(run, CFRangeMake(0, 0), &positions)
            
            for j in 0..<glyphCount {
                if let glyphPath = CTFontCreatePathForGlyph(ctFont, glyphs[j], nil) {
                    let position = positions[j]
                    let transform = CGAffineTransform(translationX: position.x, y: position.y)
                    outputPath.addPath(glyphPath, transform: transform)
                }
            }
        }
        
        let swiftUIPath = Path(outputPath)
        let bounds = swiftUIPath.boundingRect
        // Flip vertically within the bounds
        let flipped = swiftUIPath.applying(CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -bounds.height))
        return flipped
    }
}

// Note: the upstream package ships an Xcode preview here. We drop it to avoid
// pulling `PreviewProvider` / `#Preview` into the production target, where the
// Previews/ directory from the upstream repo is not vendored.
