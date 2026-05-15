Pod::Spec.new do |s|
  s.name                  = 'swift-secp256k1'
  s.version               = '0.21.1'
  s.summary               = 'P256K: Elliptic curve public key cryptography, ECDH, and Schnorr Signatures for Bitcoin.'
  s.description           = 'Source-built CocoaPods metadata for swift-secp256k1 v0.21.1 so Sovran does not embed the upstream iOS-18-built P256K.xcframework when targeting iOS 16.4.'
  s.homepage              = 'https://github.com/21-DOT-DEV/swift-secp256k1'
  s.license               = { type: 'MIT', file: 'LICENSE' }
  s.author                = { '21-DOT-DEV' => 'satoshi@21.dev' }
  s.social_media_url      = 'https://primal.net/21'

  s.ios.deployment_target = '16.4'
  s.osx.deployment_target = '15.0'
  s.tvos.deployment_target = '18.0'
  s.watchos.deployment_target = '11.0'

  s.source = {
    git: 'https://github.com/21-DOT-DEV/swift-secp256k1.git',
    commit: '8c62aba8a3011c9bcea232e5ee007fb0b34a15e2',
    submodules: true
  }

  s.requires_arc = true
  s.module_name = 'P256K'
  s.swift_version = '5.9'
  s.dependency 'libsecp256k1', '0.21.1'
  s.source_files = 'Sources/P256K/**/*.swift'
  s.preserve_paths = [
    'Sources/ZKP/**/*.swift',
    'Submodules/swift-crypto/Sources/Crypto/**/*.swift'
  ]
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
