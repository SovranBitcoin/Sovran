Pod::Spec.new do |s|
  s.name                  = 'libsecp256k1'
  s.version               = '0.21.1'
  s.summary               = 'Bitcoin Core secp256k1 C library as used by swift-secp256k1.'
  s.description           = 'Source-built libsecp256k1 target for swift-secp256k1 v0.21.1.'
  s.homepage              = 'https://github.com/21-DOT-DEV/swift-secp256k1'
  s.license               = { type: 'MIT', file: 'LICENSE' }
  s.author                = { '21-DOT-DEV' => 'satoshi@21.dev' }

  s.ios.deployment_target = '16.4'
  s.source = {
    git: 'https://github.com/21-DOT-DEV/swift-secp256k1.git',
    commit: '8c62aba8a3011c9bcea232e5ee007fb0b34a15e2',
    submodules: true
  }

  s.source_files = [
    'Sources/libsecp256k1/include/**/*.h',
    'Sources/libsecp256k1/src/**/*.{h,c}'
  ]
  s.public_header_files = 'Sources/libsecp256k1/include/**/*.h'
  s.private_header_files = 'Sources/libsecp256k1/src/**/*.h'
  s.preserve_paths = [
    'Submodules/secp256k1/include/**/*.{h,c}',
    'Submodules/secp256k1/src/**/*.{h,c}'
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/Sources/libsecp256k1/include" "${PODS_TARGET_SRCROOT}/Sources/libsecp256k1/src" "${PODS_TARGET_SRCROOT}/Submodules/secp256k1/include" "${PODS_TARGET_SRCROOT}/Submodules/secp256k1/src" "${PODS_TARGET_SRCROOT}/Submodules/secp256k1"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) ECMULT_GEN_PREC_BITS=4 ECMULT_WINDOW_SIZE=15 ENABLE_MODULE_ECDH=1 ENABLE_MODULE_ELLSWIFT=1 ENABLE_MODULE_EXTRAKEYS=1 ENABLE_MODULE_MUSIG=1 ENABLE_MODULE_RECOVERY=1 ENABLE_MODULE_SCHNORRSIG=1'
  }
end
