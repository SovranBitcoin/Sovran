/**
 * @fileoverview Public surface of the NIP-46 signer feature
 *
 * Everything Layers 3/4 (approval sheets, signer screens, camera intercept,
 * settings/drawer entries) build against. Internals — transport, engine
 * factory, method handlers, rate limiter — stay un-exported on purpose:
 * UI drives the engine singleton and the stores, nothing lower.
 */

// ── Engine control API (singleton) ──────────────────────────────
export { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
export type {
  CompleteNostrconnectPairingInput,
  Nip46DecisionAction,
  Nip46Engine,
  Nip46EngineError,
  Nip46EngineStartConfig,
  Nip46RequestDecision,
  OnUserVerdictNeeded,
} from '@/features/nostrSigner/lib/nip46Engine';

// ── Stores ──────────────────────────────────────────────────────
export {
  isCriticalGrantKey,
  useNip46ConnectionsStore,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
export type {
  ConnectionEncryption,
  ConnectionOrigin,
  GrantOrigin,
  Nip46Connection,
  Nip46Grant,
  SetGrantError,
  UpdateMetadataInput,
  UpsertAppError,
  UpsertAppInput,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
export { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
export type {
  LogActivityInput,
  Nip46ActivityEntry,
} from '@/features/nostrSigner/data/nip46ActivityStore';
export { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
export type {
  EnqueueRejection,
  Nip46PairingNotice,
  Nip46ParamsPreview,
  Nip46PendingRequest,
  Nip46SessionGrant,
  SessionGrantError,
  SessionGrantKey,
} from '@/features/nostrSigner/data/nip46RequestsStore';

// ── Hooks (service glue; mounted via shared/providers/NostrSignerProvider) ──
export {
  useNip46ConnectionsHydrated,
  useNostrSignerService,
} from '@/features/nostrSigner/hooks/useNostrSignerService';
export { useResumePendingPairing } from '@/features/nostrSigner/hooks/useResumePendingPairing';

// ── Pairing URIs (scan/paste/share) ─────────────────────────────
export {
  buildBunkerUri,
  buildPermsCsv,
  parseBunkerUri,
  parseNip46Uri,
  parseNostrconnectUri,
  parsePermsCsv,
} from '@/features/nostrSigner/lib/nip46Uri';
export type {
  BuildBunkerUriInput,
  Nip46UriError,
  ParsedBunkerUri,
  ParsedNip46Uri,
  ParsedNostrConnectUri,
  ParsedPermsCsv,
} from '@/features/nostrSigner/lib/nip46Uri';

// ── Bunker pairing secrets (share screen mint/rotate) ───────────
export {
  clearSecrets,
  listOutstanding,
  mintSecret,
} from '@/features/nostrSigner/lib/bunkerSecrets';
export type {
  BunkerSecretEntry,
  BunkerSecretsError,
} from '@/features/nostrSigner/lib/bunkerSecrets';

// ── Profile-switch pairing intent (profile picker writes; boot hook takes) ──
export {
  clearPairingIntent,
  setPairingIntent,
} from '@/features/nostrSigner/lib/pairingIntentStorage';
export type {
  PairingIntent,
  PairingIntentError,
  PairingIntentInput,
} from '@/features/nostrSigner/lib/pairingIntentStorage';

// ── Policy (sensitivity tiers for sheet copy/badges) ────────────
export { classifyRequest, grantKeyFor } from '@/features/nostrSigner/lib/permissionPolicy';
export type {
  Classification,
  ClassifyInput,
  SensitivityClass,
} from '@/features/nostrSigner/lib/permissionPolicy';

// ── Wire/domain types & UI-relevant constants ───────────────────
export {
  MAX_CONNECTED_APPS,
  MAX_EVENT_KIND,
  NIP46_ERRORS,
  REQUEST_TTL_MS,
} from '@/features/nostrSigner/lib/nip46Types';
export type {
  ActivityVerdict,
  ConnectionMode,
  ConnectionStatus,
  GrantKey,
  GrantVerdict,
  Nip46Method,
  PermToken,
  UnsignedEvent,
} from '@/features/nostrSigner/lib/nip46Types';
