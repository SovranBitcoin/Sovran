require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiquidGlassText'
  s.version        = package['version']
  s.summary        = 'Glyph-shape Liquid Glass text for iOS 26 via CoreText + SwiftUI'
  s.description    = 'Expo module exposing a SwiftUI view that applies .glassEffect(_:in:) to a TextShape path built from CoreText glyphs.'
  s.license        = 'MIT'
  s.author         = 'Sovran'
  s.homepage       = 'https://github.com/sovran/sovran-app'
  # Matches sovran-app's iOS deployment target (app.json / expo-build-properties).
  # The SwiftUI types under LiquidGlassTextSwiftUI.swift are @available(iOS 17, *)
  # and the .glassEffect(_:in:) path is @available(iOS 26, *); JS-side `isSupported`
  # in src/LiquidGlassText.tsx falls back to plain <Text> on iOS <26, so this
  # module is safe to ship at an iOS 16.4 floor.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.frameworks = 'UIKit', 'CoreText', 'SwiftUI'

  # Fail fast if built under pre-Xcode-26 toolchain — Liquid Glass symbols
  # (Glass, glassEffect, GlassEffectContainer) only exist in the iOS 26 SDK.
  s.prepare_command = <<-CMD
    if ! xcodebuild -version 2>/dev/null | grep -qE '^Xcode (2[6-9]|[3-9][0-9])'; then
      echo "error: LiquidGlassText requires Xcode 26 or later to compile." >&2
      exit 1
    fi
  CMD
end
