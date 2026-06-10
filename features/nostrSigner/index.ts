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

// ── Approval UX (catalog is the single copy/icon/tier source) ───
export {
  ACTIVITY_VERDICT_DISPLAY,
  allHandledToastCopy,
  alwaysAllowEligible,
  alwaysScopeFootnote,
  APPROVAL_BUTTON_LABELS,
  appDisplayName,
  autoSignedToastCopy,
  boundDisplay,
  encryptedPayloadLabel,
  expiredNoticeCopy,
  permissionEntryFor,
  permissionEntryForGrantKey,
  permissionTierFor,
  queueStripLabel,
  requestsWaitingToastCopy,
  SESSION_GRANT_CHECKBOX_LABEL,
  tierBannerFor,
  UNNAMED_APP_LABEL,
} from '@/features/nostrSigner/components/permissionCatalog';
export type {
  ActivityVerdictDisplay,
  CopySegment,
  PermissionCatalogEntry,
  PermissionCopyContext,
  PermissionEditorGroup,
  PermissionLookup,
  PermissionTier,
  TierBanner,
  ToastCopy,
} from '@/features/nostrSigner/components/permissionCatalog';
export { SignerApprovalSheetContent } from '@/features/nostrSigner/components/SignerApprovalSheetContent';
export {
  onSwitchAndConnect,
  SignerConnectSheetContent,
  SignerProfilePickerContent,
} from '@/features/nostrSigner/components/SignerConnectSheetContent';
export type { SwitchAndConnectTarget } from '@/features/nostrSigner/components/SignerConnectSheetContent';
export { useSignerApprovalController } from '@/features/nostrSigner/hooks/useSignerApprovalController';
export {
  encodeNostrconnectUri,
  useConnectSheetOpener,
} from '@/features/nostrSigner/hooks/useConnectSheetOpener';
export { ShareSignerScreen } from '@/features/nostrSigner/screens/ShareSignerScreen';
export { SignerActivityDetailScreen } from '@/features/nostrSigner/screens/SignerActivityDetailScreen';
export { SignerActivityScreen } from '@/features/nostrSigner/screens/SignerActivityScreen';
export { SignerAppDetailScreen } from '@/features/nostrSigner/screens/SignerAppDetailScreen';
export { SignerHubScreen } from '@/features/nostrSigner/screens/SignerHubScreen';
export { SignerRequestsScreen } from '@/features/nostrSigner/screens/SignerRequestsScreen';

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
