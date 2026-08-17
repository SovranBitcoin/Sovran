import { z } from 'zod';

export const PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY =
  'mock.payment-request-delivery-failure' as const;

/** Arms the in-app mint-fault interceptor (shared/lib/e2e/mintFaults): the
 * session Metro sets EXPO_PUBLIC_E2E_MINT_FAULTS, and the `mintFaults` step +
 * `mintFaultIntercepted` assert become available. Zero rules are armed at
 * launch — every rule flows through the dynamic step, so shared simulator
 * sessions and funded setup traffic stay passthrough until a scenario says
 * otherwise. */
export const MINT_FAULTS_CAPABILITY = 'mock.mint-faults' as const;

/** Real device-level network control (airplane mode). Satisfied ONLY by the
 * android driver, where `adb shell cmd connectivity airplane-mode` flips the
 * emulator's radios for real — the OfflineProvider sees genuine
 * `networkOffline`, not the settings mockOffline lever. Scenarios requiring
 * this token defer (◌) under the iOS sim/fake drivers. */
export const DEVICE_NETWORK_CAPABILITY = 'device.network' as const;

/** True uninstall/reinstall can retain the app's protected root secret only
 * on iOS, where Expo SecureStore uses Keychain. Android SecureStore's
 * Keystore entry is deleted with the package, so Android must never claim
 * this capability or fake it with replace-install/keep-data semantics. */
export const REINSTALL_KEYCHAIN_RETENTION_CAPABILITY = 'reinstall.keychain-retention' as const;

/**
 * The closed set of capability tokens a scenario may `require`. Capability-aware,
 * not capability-guessing: an unknown token is rejected at validation time, and
 * an unmet-but-known token is reported `deferred` at run time (never a silent
 * skip). Grouped by provider so a scenario declares exactly what it needs.
 *
 * cocod.* — feature-detected against the pinned cocod binary (SAT-only in 0.0.16:
 * see the cocod boundary in testing-json-native-adr.md). unit.usd / onchain /
 * bolt12 / multi-mint transport are deliberately absent so a scenario that needs
 * them declares an unsupported token → deferred, rather than silently "passing".
 */
export const CAPABILITIES = [
  // simulator / lifecycle
  'fresh-install',
  REINSTALL_KEYCHAIN_RETENTION_CAPABILITY,
  'mock.offline',
  DEVICE_NETWORK_CAPABILITY,
  PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
  MINT_FAULTS_CAPABILITY,
  // units
  'unit.sat',
  'unit.usd',
  // cocod counterparty (SAT-oriented)
  'cocod.status',
  'cocod.balance',
  'cocod.send.cashu',
  'cocod.receive.cashu',
  'cocod.send.bolt11',
  'cocod.receive.bolt11',
  'cocod.mints.add',
  'cocod.mints.list',
  'cocod.mints.info',
  'cocod.npc.address',
  'cocod.npc.username',
  'cocod.x-cashu',
  'cocod.history',
  // controlled network fixtures
  'relay.controlled',
  'blossom',
  // physical transports (never satisfied by the simulator)
  'ble.transport',
  'nfc.transport',
] as const;
export const capabilitySchema = z.enum(CAPABILITIES);

/** Capabilities each product driver satisfies on its own (before cocod
 * feature-detection widens the set at run time). The sim lane owns the
 * mock/fault levers; the android lane owns real airplane mode. cli.ts seeds
 * its run capabilities from these, and the viewer derives per-scenario
 * platform support from them — keep both consumers in mind when editing. */
export const DRIVER_CAPS: Record<'sim' | 'android', ReadonlySet<string>> = {
  sim: new Set([
    'fresh-install',
    REINSTALL_KEYCHAIN_RETENTION_CAPABILITY,
    'mock.offline',
    PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
    MINT_FAULTS_CAPABILITY,
    'unit.sat',
  ]),
  android: new Set(['fresh-install', 'mock.offline', DEVICE_NETWORK_CAPABILITY, 'unit.sat']),
};

export const PLATFORMS = ['ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The product driver that executes each platform. Shared by the viewer's
 * run-plan expansion and the suite orchestrator so a platform never maps to
 * two different drivers. */
export const PLATFORM_DRIVERS: Record<Platform, 'sim' | 'android'> = {
  ios: 'sim',
  android: 'android',
};

/** Driver-independent capabilities supplied by external tooling rather than
 * the device: the cocod counterparty (feature-detected at run time) and
 * controlled network fixtures. Available to every platform. */
function isCrossDriverCapability(capability: string): boolean {
  return (
    capability.startsWith('cocod.') || capability === 'relay.controlled' || capability === 'blossom'
  );
}

/** Which platforms a scenario is specified to work on, derived from its
 * `requires` exactly the way the runner defers: a platform is supported iff
 * every required capability is satisfiable there (by the driver itself or by
 * cross-driver tooling). Physical-transport and deliberately-unsupported
 * tokens (ble/nfc, unit.usd) yield an empty list — the scenario currently
 * runs nowhere. */
export function scenarioPlatforms(requires: readonly string[]): Platform[] {
  const driverFor: Record<Platform, ReadonlySet<string>> = {
    ios: DRIVER_CAPS.sim,
    android: DRIVER_CAPS.android,
  };
  return PLATFORMS.filter((platform) =>
    requires.every(
      (capability) => driverFor[platform].has(capability) || isCrossDriverCapability(capability)
    )
  );
}

/** argv[0] allowlist for `exec`/`setClipboard` — no arbitrary shell. */
export const ALLOWED_COMMANDS = ['cocod'] as const;
export const allowedCommandSchema = z.enum(ALLOWED_COMMANDS);

export const LANES = ['simulator', 'funded', 'live', 'physical'] as const;
export const laneSchema = z.enum(LANES);

const UNITS = ['sat', 'usd'] as const;
export const unitSchema = z.enum(UNITS);

const END_STATES = ['wallet', 'onboarding'] as const;
export const endStateSchema = z.enum(END_STATES);
