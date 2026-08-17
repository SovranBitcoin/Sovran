/**
 * The complete registry of zustand store hooks the e2e state mirror snapshots.
 * One entry per store module, keyed `scope/fileBasename` so viewer sections
 * group naturally. Only imported from the dev-gated mirror — never from
 * product code paths.
 *
 * Inclusion rule (enforced by app/__tests__/e2eStoreManifest.test.ts): every
 * file under the store directories whose module-level export is a zustand
 * `create(...)` hook must appear here unless it is an explicit sensitive-state
 * exclusion. Pure helpers with no store and per-call factories are excluded as
 * well. `dmEchoStore` is deliberately absent: its plaintext DM body may be a
 * live bearer ecash token and must never enter debug artifacts.
 */
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { useMempoolAddressCache } from '@/shared/stores/global/mempoolAddressCache';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useRelayMetadataStore } from '@/shared/stores/global/relayMetadataStore';
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useDataMigrationStore } from '@/shared/stores/profile/dataMigrationStore';
import { useMintDistributionStore } from '@/shared/stores/profile/mintDistributionStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';
import { useRecentPeopleStore } from '@/shared/stores/profile/recentPeopleStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';
import { useSendReachabilityStore } from '@/shared/stores/profile/sendReachabilityStore';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { useTransactionLocationStore } from '@/shared/stores/profile/transactionLocationStore';
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useDebugTierStore } from '@/shared/stores/runtime/debugTierStore';
import { useDeleteStatusStore } from '@/shared/stores/runtime/deleteStatusStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useRollbackStore } from '@/shared/stores/runtime/rollbackStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { useBitchatDmMessagesStore } from '@/features/bitchat/stores/bitchatDmMessages';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';

interface MirrorableStore {
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}

export const E2E_STORE_MANIFEST: Record<string, MirrorableStore> = {
  'global/btcMapStore': useBTCMapStore,
  'global/mempoolAddressCache': useMempoolAddressCache,
  'global/mintMetadataStore': useMintMetadataStore,
  'global/relayMetadataStore': useRelayMetadataStore,
  'global/nostrMetadataCache': useNostrMetadataCache,
  'global/pricelistStore': usePricelistStore,
  'global/profileStore': useProfileStore,
  'global/settingsStore': useSettingsStore,
  'global/walletLifecycleStore': useWalletLifecycleStore,
  'global/wallpaperStore': useWallpaperStore,
  'profile/dataMigrationStore': useDataMigrationStore,
  'profile/mintDistributionStore': useMintDistributionStore,
  'profile/mintStore': useMintStore,
  'profile/nostrSocialStore': useNostrSocialStore,
  'profile/npcMintStore': useNpcMintStore,
  'profile/nutDropRedeemQueueStore': useNutDropRedeemQueueStore,
  'profile/ownContentStore': useOwnContentStore,
  'profile/ownedMediaStore': useOwnedMediaStore,
  'profile/recentPeopleStore': useRecentPeopleStore,
  'profile/routstrStore': useRoutstrStore,
  'profile/scanHistoryStore': useScanHistoryStore,
  'profile/searchHistoryStore': useSearchHistoryStore,
  'profile/sendReachabilityStore': useSendReachabilityStore,
  'profile/swapTransactionsStore': useSwapTransactionsStore,
  'profile/themeStore': useThemeStore,
  'profile/transactionAnnotationStore': useTransactionAnnotationStore,
  'profile/transactionDistributionStore': useTransactionDistributionStore,
  'profile/transactionLocationStore': useTransactionLocationStore,
  'runtime/amountDraftStore': useAmountDraftStore,
  'runtime/contactSendStore': useContactSendStore,
  'runtime/debugTierStore': useDebugTierStore,
  'runtime/deleteStatusStore': useDeleteStatusStore,
  'runtime/mockDataStore': useMockDataStore,
  'runtime/nearPayStore': useNearPaySessionStore,
  'runtime/nfcTapStore': useNfcTapStore,
  'runtime/paymentStatusStore': usePaymentStatusStore,
  'runtime/popupStore': usePopupStore,
  'runtime/rollbackStore': useRollbackStore,
  'runtime/routstrTopUpStore': useRoutstrTopUpStore,
  'runtime/swapStatusStore': useSwapStatusStore,
  'bitchat/bitchatDmMessages': useBitchatDmMessagesStore,
  'feed/ignoreStore': useFeedIgnoreStore,
  'feed/notificationPolicyStore': useNotificationPolicyStore,
};
