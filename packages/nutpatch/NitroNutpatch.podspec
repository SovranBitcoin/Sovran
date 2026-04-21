require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroNutpatch"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/mrousavy/nitro.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects + C crypto core)
    "cpp/core/**/*.{hpp,cpp,h,c}",
    # secp256k1 (only the 3 compilation units, not tests/examples)
    "cpp/vendor/secp256k1/src/secp256k1.c",
    "cpp/vendor/secp256k1/src/precomputed_ecmult.c",
    "cpp/vendor/secp256k1/src/precomputed_ecmult_gen.c",
  ]

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/cpp/vendor/secp256k1/include" "$(PODS_TARGET_SRCROOT)/cpp/vendor/secp256k1/src" "$(PODS_TARGET_SRCROOT)/cpp/vendor/secp256k1"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) SECP256K1_STATIC=1 ENABLE_MODULE_EXTRAKEYS=1 ENABLE_MODULE_SCHNORRSIG=1',
  }

  load File.join(__dir__, 'nitrogen/generated/ios/NitroNutpatch+autolinking.rb')
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
