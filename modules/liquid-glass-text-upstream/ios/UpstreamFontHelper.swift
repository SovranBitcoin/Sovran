//
//  File.swift
//  LiquidGlassText
//
//  Created by Daniel Crompton on 9/6/25.
//

import SwiftUI

// Public so the public initializers in UpstreamLiquidGlassTextSwiftUI can
// reference them as default-argument values. The sibling `liquid-glass-text`
// module does not declare these names, so there is no symbol collision risk.
#if os(iOS) || os(visionOS) || os(tvOS)
    public typealias UXFont = UIFont
    public typealias UXDesign = UIFontDescriptor.SystemDesign
    public typealias UXWeight = UIFont.Weight
    public typealias UXWidth = UIFont.Width
    public typealias UXDescriptor = UIFontDescriptor
#elseif os(macOS)
    public typealias UXFont = NSFont
    public typealias UXDesign = NSFontDescriptor.SystemDesign
    public typealias UXWeight = NSFont.Weight
    public typealias UXWidth = NSFont.Width
    public typealias UXDescriptor = NSFontDescriptor
#endif

struct UpstreamFontHelper {
    
    
    private init() { }
    
    static func font(forSize size: CGFloat, weight: UXWeight, width: UXWidth, design: UXDesign) -> UXFont {
        
        let baseDescriptor = UXFont.systemFont(ofSize: size).fontDescriptor
        
        let descriptorWithDesign = baseDescriptor.withDesign(design) ?? baseDescriptor
        let descriptor = descriptorWithDesign.addingAttributes([
            UXDescriptor.AttributeName.traits: [
                UXDescriptor.TraitKey.weight: weight,
                UXDescriptor.TraitKey.width: width
            ]
        ])
        
        // UIFont(descriptor:size:) returns non-optional on iOS; NSFont's
        // counterpart returns Optional. Branch so both compile cleanly.
        #if os(iOS) || os(visionOS) || os(tvOS)
        return UXFont(descriptor: descriptor, size: size)
        #else
        return UXFont(descriptor: descriptor, size: size) ?? UXFont.systemFont(ofSize: size)
        #endif
    }
    
    static func font(named name: String, size: CGFloat) -> UXFont {
        UXFont(name: name, size: size) ?? .systemFont(ofSize: size)
    }
}
