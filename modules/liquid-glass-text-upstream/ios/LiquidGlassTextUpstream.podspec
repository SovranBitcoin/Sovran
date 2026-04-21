require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiquidGlassTextUpstream'
  s.version        = package['version']
  s.summary        = 'Reference Liquid Glass text view vendored from DanielCrompton123/LiquidGlassText'
  s.description    = 'Expo module wrapping the upstream LiquidGlassText Swift package for A/B comparison against our in-tree liquid-glass-text module.'
  s.license        = 'MIT'
  s.author         = 'Sovran'
  s.homepage       = 'https://github.com/sovran/sovran-app'
  # Matches sovran-app's iOS deployment target (app.json / expo-build-properties).
  s.platforms      = { :ios => '18.0' }
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

  # Same gate as the sibling module: Liquid Glass symbols require Xcode 26.
  s.prepare_command = <<-CMD
    if ! xcodebuild -version 2>/dev/null | grep -qE '^Xcode (2[6-9]|[3-9][0-9])'; then
      echo "error: LiquidGlassTextUpstream requires Xcode 26 or later to compile." >&2
      exit 1
    fi
  CMD
end
