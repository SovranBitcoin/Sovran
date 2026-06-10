/**
 * @fileoverview Public surface of the NIP-46 signer feature
 *
 * The curated barrel: only what app routes, the camera intercept, the drawer,
 * and settings actually import lives here. Everything else — the engine
 * singleton, transport, stores beyond the two below, catalog helpers, URI
 * codec, pairing intents — is reached by deep import from its module (the
 * provider and PopupHost do exactly that), keeping this surface minimal so
 * `bun run knip` stays green.
 */

// ── Stores (drawer badge, settings entry, app-detail screen) ────
export { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
export { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';

// ── Catalog (app-detail header copy) ────────────────────────────
export { appDisplayName } from '@/features/nostrSigner/components/permissionCatalog';

// ── Screens (signer-flow routes) ────────────────────────────────
export { ShareSignerScreen } from '@/features/nostrSigner/screens/ShareSignerScreen';
export { SignerActivityDetailScreen } from '@/features/nostrSigner/screens/SignerActivityDetailScreen';
export { SignerActivityScreen } from '@/features/nostrSigner/screens/SignerActivityScreen';
export { SignerAppDetailScreen } from '@/features/nostrSigner/screens/SignerAppDetailScreen';
export { SignerAppPermissionsScreen } from '@/features/nostrSigner/screens/SignerAppPermissionsScreen';
export { SignerAppPersonScreen } from '@/features/nostrSigner/screens/SignerAppPersonScreen';
export { SignerHubScreen } from '@/features/nostrSigner/screens/SignerHubScreen';
export { SignerRequestsScreen } from '@/features/nostrSigner/screens/SignerRequestsScreen';

// ── Pairing entry dispatch (camera scan / paste / deep link) ────
export {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
  PAIRING_ERROR_INVALID_QR,
  PAIRING_ERROR_TITLE,
} from '@/features/nostrSigner/lib/openPairingFromUri';

// ── Pairing URI type (consumed by the popup action-sheet payloads) ──
export type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';
