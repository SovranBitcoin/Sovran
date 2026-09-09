#!/usr/bin/env node
// Copies the headless subset of the vendored bitchat-android sources
// (android/BitChatVendor git submodule) into the gitignored generated source
// dir android/vendor-src/, applying Sovran patches during the copy. Runs on
// postinstall, mirroring patch-bitchat-imports.js for the iOS submodule.
//
// Why copy instead of gradle sourceSets + excludes: we need ~15 file-level
// exclusions inside otherwise-included packages (ui/, nostr/, services/), and
// AGP/KGP exclude filters are not reliably honored by Kotlin compile tasks.
// The copy also keeps the submodule pristine and makes the vendored surface an
// explicit, reviewable list.
//
// --- Upgrading the bitchat-android submodule ---
//   1) cd modules/bitchat-module/android/BitChatVendor
//   2) git fetch origin && git checkout <sha>
//   3) cd back to repo root, run `bun install` (postinstall re-runs this)
//   4) `npx expo prebuild -p android` and build
//   5) If an allowlist entry or patch anchor stops matching, this script fails
//      loudly — fix the list/anchor against the new upstream shape.

const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.resolve(__dirname, '..', 'android');
const VENDOR = path.join(MODULE_ROOT, 'BitChatVendor');
const VENDOR_SRC = path.join(VENDOR, 'app', 'src', 'main', 'java', 'com', 'bitchat', 'android');
const VENDOR_ASSETS = path.join(VENDOR, 'app', 'src', 'main', 'assets');
const DEST_SRC = path.join(MODULE_ROOT, 'vendor-src', 'com', 'bitchat', 'android');
const DEST_ASSETS = path.join(MODULE_ROOT, 'vendor-assets');

if (!fs.existsSync(VENDOR_SRC)) {
  console.log(
    `[sync-bitchat-android] ${VENDOR_SRC} not present (submodule not checked out?), skipping.`
  );
  process.exit(0);
}

function readExistingVendorCommit(file, pattern) {
  try {
    const match = fs.readFileSync(file, 'utf8').match(pattern);
    const commit = match?.[1]?.trim();
    if (commit && commit !== 'unknown') return commit;
  } catch {
    /* generated file absent — fall through to unknown */
  }
  return 'unknown';
}

// Headless subset: BLE mesh + Noise + identity + low-level Nostr. Everything
// Compose/Activity/Tor/location-coupled stays out; the four excluded classes
// the subset still references (ui.NotificationManager, services.NicknameProvider,
// services.MessageRouter, net.OkHttpProvider) are stubbed in
// android/src/main/java/com/bitchat/android/ (same trick as iOS TorStub.swift).
const INCLUDE_DIRS = ['mesh', 'noise', 'protocol', 'model', 'sync', 'util', 'services/meshgraph'];
const INCLUDE_FILES = [
  'crypto/EncryptionService.kt',
  'identity/SecureIdentityStateManager.kt',
  // Referenced (fully qualified) from mesh/MessageHandler + BluetoothMeshService.
  'favorites/FavoritesPersistenceService.kt',
  'services/VerificationService.kt',
  'services/AppStateStore.kt',
  'services/SeenMessageStore.kt',
  // Compose-free debug managers; mesh imports DebugSettingsManager + DebugScanResult.
  'ui/debug/DebugSettingsManager.kt',
  'ui/debug/DebugPreferenceManager.kt',
  'ui/NotificationTextUtils.kt',
  'features/file/FileUtils.kt',
  // Referenced fully-qualified from nostr/RelayDirectory.closestRelaysForGeohash.
  'geohash/Geohash.kt',
  // Low-level Nostr (relay client + crypto + identity). The UI-coupled handlers
  // (GeohashRepository, GeohashMessageHandler, NostrDirectMessageHandler,
  // NostrTransport, LocationNotes*, NostrTestManager, NostrClient) stay out —
  // BitChatNostrBridge.kt replaces them.
  'nostr/NostrEvent.kt',
  'nostr/NostrFilter.kt',
  'nostr/NostrRequest.kt',
  'nostr/NostrCrypto.kt',
  'nostr/NostrIdentity.kt',
  'nostr/NostrProofOfWork.kt',
  'nostr/PoWPreferenceManager.kt',
  'nostr/NostrProtocol.kt',
  'nostr/NostrEmbeddedBitChat.kt',
  'nostr/NostrRelayManager.kt',
  'nostr/NostrSubscriptionManager.kt',
  'nostr/NostrEventDeduplicator.kt',
  'nostr/RelayDirectory.kt',
  'nostr/Bech32.kt',
  'nostr/GeohashAliasRegistry.kt',
  'nostr/GeohashConversationRegistry.kt',
];
const INCLUDE_ASSETS = ['nostr_relays.csv'];

// Anchored patches applied during the copy. Each must apply (or the patched
// form must already exist — they never do on a fresh copy, but keep the check
// cheap and uniform). A missed anchor means upstream changed shape: fail loudly.
const PATCHES = [
  {
    file: 'mesh/PowerManager.kt',
    name: 'CHARGING_BALANCED_DISCOVERY',
    anchor: /isCharging && !isAppInBackground -> PowerMode\.PERFORMANCE/,
    replacement:
      '// [sovran] Charging is not a request for continuous scanning.\n' +
      '            isCharging && !isAppInBackground -> PowerMode.BALANCED',
  },
  {
    file: 'mesh/BluetoothMeshService.kt',
    name: 'ENCRYPTION_SERVICE_INTERNAL',
    anchor: /    private val encryptionService = EncryptionService\(context\)/,
    replacement:
      '    // [sovran] internal — BitChatBLEBridge.resetPrivateChat() clears Noise\n' +
      '    // sessions via encryptionService; the vendor exposes no public reset.\n' +
      '    internal val encryptionService = EncryptionService(context)',
  },
  {
    file: 'mesh/BluetoothPermissionManager.kt',
    name: 'ANDROID_12_BLE_PERMISSIONS_NO_LOCATION',
    anchor: /    fun hasBluetoothPermissions\(\): Boolean \{\n[\s\S]*?\n    \}\n\}/,
    replacement:
      '    fun hasBluetoothPermissions(): Boolean {\n' +
      '        // [sovran] Android 12+ BLE is gated by the runtime Bluetooth\n' +
      '        // permissions only. Our manifest declares BLUETOOTH_SCAN with\n' +
      '        // neverForLocation, so requiring location here makes a clean\n' +
      '        // install report "poweredOn" in JS while the vendor refuses to\n' +
      '        // advertise or scan. Keep this aligned with BluetoothStateMonitor.\n' +
      '        val permissions =\n' +
      '            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {\n' +
      '                listOf(\n' +
      '                    Manifest.permission.BLUETOOTH_ADVERTISE,\n' +
      '                    Manifest.permission.BLUETOOTH_CONNECT,\n' +
      '                    Manifest.permission.BLUETOOTH_SCAN\n' +
      '                )\n' +
      '            } else {\n' +
      '                listOf(\n' +
      '                    Manifest.permission.BLUETOOTH,\n' +
      '                    Manifest.permission.BLUETOOTH_ADMIN,\n' +
      '                    Manifest.permission.ACCESS_FINE_LOCATION\n' +
      '                )\n' +
      '            }\n' +
      '\n' +
      '        return permissions.all {\n' +
      '            ActivityCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED\n' +
      '        }\n' +
      '    }\n' +
      '}',
  },
  {
    file: 'mesh/BluetoothConnectionManager.kt',
    name: 'CONNECTION_START_RETURNS_REAL_FAILURE',
    anchor:
      /    \/\*\*\n     \* Start all Bluetooth services with power optimization\n     \*\/\n    fun startServices\(\): Boolean \{\n[\s\S]*?\n    \}\n    \n    \/\*\*\n     \* Stop all Bluetooth services with proper cleanup/,
    replacement:
      '    /**\n' +
      '     * Start all Bluetooth services with power optimization\n' +
      '     */\n' +
      '    fun startServices(): Boolean {\n' +
      '        Log.i(TAG, "Starting power-optimized Bluetooth services...")\n' +
      '\n' +
      '        if (!permissionManager.hasBluetoothPermissions()) {\n' +
      '            Log.e(TAG, "Missing Bluetooth permissions")\n' +
      '            return false\n' +
      '        }\n' +
      '\n' +
      '        if (bluetoothAdapter?.isEnabled != true) {\n' +
      '            Log.e(TAG, "Bluetooth is not enabled")\n' +
      '            return false\n' +
      '        }\n' +
      '\n' +
      '        try {\n' +
      '            isActive = true\n' +
      '            Log.d(TAG, "ConnectionManager activated (permissions and adapter OK)")\n' +
      '\n' +
      '        // set the adapter name to our 8-character peerID for iOS privacy, TODO: Make this configurable\n' +
      '        // try {\n' +
      '        //     if (bluetoothAdapter?.name != myPeerID) {\n' +
      '        //         bluetoothAdapter?.name = myPeerID\n' +
      '        //         Log.d(TAG, "Set Bluetooth adapter name to peerID: $myPeerID for iOS compatibility.")\n' +
      '        //     }\n' +
      '        // } catch (se: SecurityException) {\n' +
      '        //     Log.e(TAG, "Missing BLUETOOTH_CONNECT permission to set adapter name.", se)\n' +
      '        // }\n' +
      '\n' +
      '            // [sovran] Return a real startup failure to the Expo bridge. The\n' +
      '            // upstream code launched this block asynchronously and returned\n' +
      '            // true before server/client startup could fail, which made JS log\n' +
      '            // ble_start_ok even when native BLE had refused to start.\n' +
      '            connectionTracker.start()\n' +
      '            powerManager.start()\n' +
      '\n' +
      '            val dbg = try { com.bitchat.android.ui.debug.DebugSettingsManager.getInstance() } catch (_: Exception) { null }\n' +
      '            val startServer = dbg?.gattServerEnabled?.value != false\n' +
      '            val startClient = dbg?.gattClientEnabled?.value != false\n' +
      '\n' +
      '            if (startServer) {\n' +
      '                if (!serverManager.start()) {\n' +
      '                    Log.e(TAG, "Failed to start server manager")\n' +
      '                    powerManager.stop()\n' +
      '                    connectionTracker.stop()\n' +
      '                    isActive = false\n' +
      '                    return false\n' +
      '                }\n' +
      '                Log.d(TAG, "GATT Server started")\n' +
      '            } else {\n' +
      '                Log.i(TAG, "GATT Server disabled by debug settings; not starting")\n' +
      '            }\n' +
      '\n' +
      '            if (startClient) {\n' +
      '                if (!clientManager.start()) {\n' +
      '                    Log.e(TAG, "Failed to start client manager")\n' +
      '                    serverManager.stop()\n' +
      '                    powerManager.stop()\n' +
      '                    connectionTracker.stop()\n' +
      '                    isActive = false\n' +
      '                    return false\n' +
      '                }\n' +
      '                Log.d(TAG, "GATT Client started")\n' +
      '            } else {\n' +
      '                Log.i(TAG, "GATT Client disabled by debug settings; not starting")\n' +
      '            }\n' +
      '\n' +
      '            Log.i(TAG, "Bluetooth services started successfully")\n' +
      '            return true\n' +
      '        } catch (e: Exception) {\n' +
      '            Log.e(TAG, "Failed to start Bluetooth services: ${e.message}")\n' +
      '            isActive = false\n' +
      '            return false\n' +
      '        }\n' +
      '    }\n' +
      '    \n' +
      '    /**\n' +
      '     * Stop all Bluetooth services with proper cleanup',
  },
  {
    file: 'mesh/BluetoothMeshService.kt',
    name: 'MESH_START_RETURNS_BOOLEAN',
    anchor:
      /    \/\*\*\n     \* Start the mesh service\n     \*\/\n    fun startServices\(\) \{\n[\s\S]*?\n    \}\n    \n    \/\*\*\n     \* Stop all mesh services/,
    replacement:
      '    /**\n' +
      '     * Start the mesh service\n' +
      '     */\n' +
      '    fun startServices(): Boolean {\n' +
      '        // Prevent double starts (defensive programming)\n' +
      '        if (isActive) {\n' +
      '            Log.w(TAG, "Mesh service already active, ignoring duplicate start request")\n' +
      '            return true\n' +
      '        }\n' +
      '        if (terminated) {\n' +
      '            // This instance scope was cancelled previously; refuse to start to avoid using dead scopes.\n' +
      '            Log.e(TAG, "Mesh service instance was terminated; create a new instance instead of restarting")\n' +
      '            return false\n' +
      '        }\n' +
      '\n' +
      '        Log.i(TAG, "Starting Bluetooth mesh service with peer ID: $myPeerID")\n' +
      '\n' +
      '        return if (connectionManager.startServices()) {\n' +
      '            isActive = true\n' +
      '\n' +
      '            // Start periodic announcements for peer discovery and connectivity\n' +
      '            sendPeriodicBroadcastAnnounce()\n' +
      '            Log.d(TAG, "Started periodic broadcast announcements (every 30 seconds)")\n' +
      '            // Start periodic syncs\n' +
      '            gossipSyncManager.start()\n' +
      '            Log.d(TAG, "GossipSyncManager started")\n' +
      '            true\n' +
      '        } else {\n' +
      '            Log.e(TAG, "Failed to start Bluetooth services")\n' +
      '            false\n' +
      '        }\n' +
      '    }\n' +
      '    \n' +
      '    /**\n' +
      '     * Stop all mesh services',
  },
  {
    file: 'protocol/BinaryProtocol.kt',
    name: 'BINARY_PROTOCOL_HEADER_SIZES',
    anchor: /    private const val HEADER_SIZE_V1 = 13\n    private const val HEADER_SIZE_V2 = 15/,
    replacement:
      '    // [sovran] The fixed header is version/type/ttl (3) + timestamp (8)\n' +
      '    // + flags (1) + payload length (2 for v1, 4 for v2). Upstream Android\n' +
      '    // was off by one, which made exact-boundary 512-byte iOS fragments\n' +
      '    // underflow while decoding.\n' +
      '    private const val HEADER_SIZE_V1 = 14\n' +
      '    private const val HEADER_SIZE_V2 = 16',
  },
  {
    file: 'mesh/FragmentManager.kt',
    name: 'FRAGMENT_MANAGER_HEADER_SIZES',
    anchor: /        val headerSize = if \(version == 2\) 15 else 13/,
    replacement:
      '        // [sovran] Match BinaryProtocol: v1 header is 14 bytes, v2 is 16.\n' +
      '        val headerSize = if (version == 2) 16 else 14',
  },
  // --- Re-handshake recovery (port of iOS NoiseSessionManager) ---
  //
  // When a fresh Noise handshake init arrives while we already hold an
  // ESTABLISHED session, the peer restarted / cleared its session (e.g. app
  // reinstall). Upstream iOS tears the stale session down and re-handshakes as
  // responder (NoiseSessionManager.handleIncomingHandshake:112-132); Android did
  // not — it processed the init on the stale session, so the session never
  // re-established and onSessionEstablished never re-fired, leaving identity (the
  // [FAVORITED] favorite) un-re-exchanged. Mirror the iOS behavior here.
  {
    file: 'noise/NoiseSessionManager.kt',
    name: 'REHANDSHAKE_RECOVERY',
    anchor:
      /            \/\/ If no session exists, create one as responder\n            if \(session == null\) \{/,
    replacement:
      '            // [sovran] re-handshake recovery (port of iOS\n' +
      '            // NoiseSessionManager.handleIncomingHandshake): a fresh handshake init\n' +
      '            // while we hold an ESTABLISHED session means the peer restarted /\n' +
      '            // cleared its session. Tear ours down so a new responder session is\n' +
      '            // created below and onSessionEstablished re-fires, re-exchanging\n' +
      '            // identity (the [FAVORITED] favorite).\n' +
      '            if (session != null && session.isEstablished()) {\n' +
      '                Log.d(TAG, "Accepting handshake from $peerID despite established session — peer likely restarted")\n' +
      '                removeSession(peerID)\n' +
      '                session = null\n' +
      '            }\n' +
      '\n' +
      '            // If no session exists, create one as responder\n' +
      '            if (session == null) {',
  },
  // --- Extend PrivateMessagePacket content length (0xFF sentinel) ---
  //
  // Mirror of the iOS Packets.swift patch (patch-bitchat-imports.js). Lets a
  // private DM carry content >255 bytes (a whole ecash token + a creq-bearing
  // favorite): content length 0x00–0xFE = literal 1 byte (stock-identical);
  // 0xFF = sentinel + 2-byte big-endian length (≤64 KB). messageID stays 1-byte.
  // Stock misparses our >254-byte content — acceptable (Sovran↔Sovran payments).
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_ENCODE_GUARD',
    anchor:
      /        if \(messageIDData\.size > 255 \|\| contentData\.size > 255\) \{\n            return null\n        \}/,
    replacement:
      '        // [sovran] extended content length: messageID 1-byte, content ≤64 KB.\n' +
      '        if (messageIDData.size > 255 || contentData.size > 0xFFFF) {\n' +
      '            return null\n' +
      '        }',
  },
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_ENCODE_LEN',
    anchor:
      /        result\.add\(TLVType\.CONTENT\.value\.toByte\(\)\)\n        result\.add\(contentData\.size\.toByte\(\)\)/,
    replacement:
      '        result.add(TLVType.CONTENT.value.toByte())\n' +
      '        // [sovran] 0x00–0xFE literal; 0xFF sentinel + 2-byte big-endian length.\n' +
      '        if (contentData.size <= 0xFE) {\n' +
      '            result.add(contentData.size.toByte())\n' +
      '        } else {\n' +
      '            result.add(0xFF.toByte())\n' +
      '            result.add(((contentData.size shr 8) and 0xFF).toByte())\n' +
      '            result.add((contentData.size and 0xFF).toByte())\n' +
      '        }',
  },
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_DECODE_LEN',
    anchor:
      /                val length = data\[offset\]\.toUByte\(\)\.toInt\(\)\n                offset \+= 1/,
    replacement:
      '                // [sovran] extended length read: 0xFF sentinel → 2-byte BE.\n' +
      '                var length = data[offset].toUByte().toInt()\n' +
      '                offset += 1\n' +
      '                if (length == 0xFF) {\n' +
      '                    if (offset + 2 > data.size) return null\n' +
      '                    length = (data[offset].toUByte().toInt() shl 8) or data[offset + 1].toUByte().toInt()\n' +
      '                    offset += 2\n' +
      '                }',
  },
];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(rel, patches) {
  const src = path.join(VENDOR_SRC, rel);
  if (!fs.existsSync(src)) {
    console.error(`[sync-bitchat-android] FATAL: allowlisted path missing upstream: ${rel}`);
    process.exit(1);
  }
  let content = fs.readFileSync(src, 'utf8');
  for (const patch of patches.filter((p) => p.file === rel)) {
    const next = content.replace(patch.anchor, patch.replacement);
    if (next === content) {
      console.error(
        `[sync-bitchat-android] FATAL: patch ${patch.name} anchor matched nothing in ${rel}. ` +
          'Upstream changed shape — fix the anchor.'
      );
      process.exit(1);
    }
    content = next;
  }
  const dest = path.join(DEST_SRC, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return 1;
}

function copyDir(relDir, patches) {
  const srcDir = path.join(VENDOR_SRC, relDir);
  if (!fs.existsSync(srcDir)) {
    console.error(`[sync-bitchat-android] FATAL: allowlisted dir missing upstream: ${relDir}`);
    process.exit(1);
  }
  let count = 0;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = path.join(relDir, ent.name);
    if (ent.isDirectory()) count += copyDir(rel, patches);
    else if (ent.name.endsWith('.kt') || ent.name.endsWith('.java'))
      count += copyFile(rel, patches);
  }
  return count;
}

rmrf(path.join(MODULE_ROOT, 'vendor-src'));
rmrf(DEST_ASSETS);

let copied = 0;
for (const dir of INCLUDE_DIRS) copied += copyDir(dir, PATCHES);
for (const file of INCLUDE_FILES) copied += copyFile(file, PATCHES);

fs.mkdirSync(DEST_ASSETS, { recursive: true });
for (const asset of INCLUDE_ASSETS) {
  const src = path.join(VENDOR_ASSETS, asset);
  if (!fs.existsSync(src)) {
    console.error(`[sync-bitchat-android] FATAL: asset missing upstream: ${asset}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST_ASSETS, asset));
}

// The app depends on this module via `file:` — bun COPIES the package into
// node_modules before postinstall runs, and Expo's Android autolinking builds
// that copy (iOS resolves ../modules/bitchat-module directly). Mirror the
// generated sources into the copy so a fresh install (EAS) is deterministic.
// Under the bun workspace the copy may hoist to the workspace-root node_modules,
// so locate it by walking up from app/ instead of assuming app/node_modules.
const NODE_MODULES_COPY = (() => {
  let dir = path.resolve(__dirname, '..', '..', '..'); // app/
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'node_modules', 'bitchat-module', 'android');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(
    path.resolve(__dirname, '..', '..', '..'),
    'node_modules',
    'bitchat-module',
    'android'
  );
})();
if (fs.existsSync(NODE_MODULES_COPY) && fs.realpathSync(NODE_MODULES_COPY) !== MODULE_ROOT) {
  for (const sub of ['vendor-src', 'vendor-assets']) {
    rmrf(path.join(NODE_MODULES_COPY, sub));
    fs.cpSync(path.join(MODULE_ROOT, sub), path.join(NODE_MODULES_COPY, sub), { recursive: true });
  }
}

// Bake the vendored submodule commit into a generated Kotlin constant so the
// running build's bitchat version is logged at startBLE (bitchat.peers.ble_start_ok)
// — catching a stale build that predates a fragmentation/protocol fix. Best-effort;
// preserves the existing baked SHA when EAS_NO_VCS archives strip .git metadata.
(function writeVendorVersion() {
  const out = path.join(
    MODULE_ROOT,
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'bitchat',
    'BitchatVendorVersion.kt'
  );
  let commit = readExistingVendorCommit(out, /const val commit = "([^"]+)"/);
  try {
    const gitCommit = require('child_process')
      .execSync('git rev-parse --short HEAD', { cwd: VENDOR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (gitCommit) commit = gitCommit;
  } catch {
    /* git unavailable — keep the existing baked SHA */
  }
  fs.writeFileSync(
    out,
    '// GENERATED at sync by scripts/sync-bitchat-android.js — do not edit by hand.\n' +
      '// Short SHA of the vendored android/BitChatVendor submodule this build compiled from,\n' +
      '// logged at startBLE so the running build’s bitchat version is verifiable.\n' +
      'package expo.modules.bitchat\n\n' +
      'object BitchatVendorVersion {\n' +
      `    const val commit = "${commit}"\n` +
      '}\n'
  );
  console.log(`[sync-bitchat-android] vendor version: ${commit}`);
})();

console.log(
  `[sync-bitchat-android] copied ${copied} source file(s) + ${INCLUDE_ASSETS.length} asset(s)`
);
