require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
# bitchat submodule lives inside this pod's directory.
# CocoaPods silently drops source_files paths that escape the podspec dir
# via `..`, so the submodule must live underneath this directory.
bitchat_root = 'BitChatVendor'

Pod::Spec.new do |s|
  s.name           = 'BitChatModule'
  s.version        = package['version']
  s.summary        = 'BitChat geohash-based Nostr chat + BLE mesh module'
  s.description    = 'Expo module wrapping BitChat protocol for geohash-based location chat and Bluetooth mesh'
  s.license        = 'MIT'
  s.author         = 'Sovran'
  s.homepage       = 'https://github.com/permissionlesstech/bitchat'
  # iOS 18 required by swift-secp256k1 CocoaPods distribution.
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # swift-secp256k1 provides the `P256K` module upstream bitchat uses for
  # Schnorr signing (NostrIdentity) and ECDH (NIP-44). Pinning to 0.21.1 to
  # match what bitchat's own Package.resolved ships with.
  s.dependency 'swift-secp256k1', '~> 0.21.1'

  # Ship upstream bitchat's auto-maintained 304-relay geohash directory so
  # GeoRelayDirectory.loadLocalEntries() finds it via
  # Bundle.main.url(forResource: "online_relays_gps", withExtension: "csv").
  s.resources = ["#{bitchat_root}/relays/online_relays_gps.csv"]

  # --- Local bridge files + BitChat source files from sibling repo ---
  s.source_files = [
    '*.swift',
    # BitFoundation (core types: BitchatPacket, BitchatMessage, PeerID, etc.)
    "#{bitchat_root}/localPackages/BitFoundation/Sources/**/*.swift",
    # BitLogger
    "#{bitchat_root}/localPackages/BitLogger/Sources/**/*.swift",
    # Core logic (Services, Protocols, Models, Noise, Identity, Nostr, Sync, Utils)
    "#{bitchat_root}/bitchat/Services/**/*.swift",
    "#{bitchat_root}/bitchat/Protocols/**/*.swift",
    "#{bitchat_root}/bitchat/Models/**/*.swift",
    "#{bitchat_root}/bitchat/Noise/**/*.swift",
    "#{bitchat_root}/bitchat/Identity/**/*.swift",
    "#{bitchat_root}/bitchat/Nostr/**/*.swift",
    "#{bitchat_root}/bitchat/Sync/**/*.swift",
    "#{bitchat_root}/bitchat/Utils/**/*.swift",
  ]

  # Exclude: Views, ViewModels, App entry, Preview helpers, Features (voice/media), Tests
  s.exclude_files = [
    "#{bitchat_root}/bitchat/Views/**/*",
    "#{bitchat_root}/bitchat/ViewModels/**/*",
    "#{bitchat_root}/bitchat/BitchatApp.swift",
    "#{bitchat_root}/bitchat/_PreviewHelpers/**/*",
    "#{bitchat_root}/bitchat/Features/**/*",
    "#{bitchat_root}/localPackages/*/Tests/**/*",
  ]


  # Arti/Tor stub — we provide our own no-op TorManager
  # Do NOT include the real Arti package (requires Rust xcframeworks)

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) SOVRAN_BRIDGE',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) SOVRAN_BRIDGE=1',
  }

  # CoreBluetooth is a system framework — needed for BLE mesh
  s.frameworks = 'CoreBluetooth', 'CoreLocation', 'CryptoKit'
end
