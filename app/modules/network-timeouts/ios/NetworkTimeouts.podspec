require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NetworkTimeouts'
  s.version        = package['version']
  s.summary        = 'Raises the idle timeout of expo/fetch on iOS'
  s.description    = 'Expo module that supplies expo/fetch with a URLSessionConfiguration whose per-request idle timeout is long enough for a Routstr node to finish buffering a whole completion before sending its first byte.'
  s.license        = 'MIT'
  s.author         = 'Sovran'
  s.homepage       = 'https://github.com/sovran/sovran-app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # `ExpoFetchCustomExtension` lives in the `Expo` pod (expo/ios/Fetch).
  s.dependency 'Expo'

  s.source_files = '*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
