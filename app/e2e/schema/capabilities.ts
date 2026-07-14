import { z } from 'zod';

export const PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY =
  'mock.payment-request-delivery-failure' as const;

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
  'mock.offline',
  PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
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

export type Capability = (typeof CAPABILITIES)[number];
export const capabilitySchema = z.enum(CAPABILITIES);

/** argv[0] allowlist for `exec`/`setClipboard` — no arbitrary shell. */
export const ALLOWED_COMMANDS = ['cocod'] as const;
export const allowedCommandSchema = z.enum(ALLOWED_COMMANDS);

export const LANES = ['simulator', 'funded', 'live', 'physical'] as const;
export const laneSchema = z.enum(LANES);

export const UNITS = ['sat', 'usd'] as const;
export const unitSchema = z.enum(UNITS);

export const END_STATES = ['wallet', 'onboarding'] as const;
export const endStateSchema = z.enum(END_STATES);
