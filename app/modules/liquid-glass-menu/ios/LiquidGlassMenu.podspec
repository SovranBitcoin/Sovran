require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiquidGlassMenu'
  s.version        = package['version']
  s.summary        = 'A UIKit Liquid Glass button + UIMenu for iOS 26'
  s.description    = 'Expo module exposing a UIKit UIButton with .configuration = .glass() that owns a UIMenu, so the glass trigger morphs into its menu on iOS 26 while scrolling correctly inside an RN ScrollView (unlike a SwiftUI UIHostingController).'
  s.license        = 'MIT'
  s.author         = 'Sovran'
  s.homepage       = 'https://github.com/sovran/sovran-app'
  # Matches sovran-app's iOS deployment target (app.json / expo-build-properties).
  # The `.glass()` configuration path is gated by @available(iOS 26, *); JS-side
  # `isSupported` falls back to a GlassView menu on iOS <26, so this module is
  # safe to ship at an iOS 16.4 floor.
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

  s.frameworks = 'UIKit'

  # Fail fast if built under pre-Xcode-26 toolchain — the `.glass()` button
  # configuration symbol only exists in the iOS 26 SDK.
  s.prepare_command = <<-CMD
    if ! xcodebuild -version 2>/dev/null | grep -qE '^Xcode (2[6-9]|[3-9][0-9])'; then
      echo "error: LiquidGlassMenu requires Xcode 26 or later to compile." >&2
      exit 1
    fi
  CMD
end
