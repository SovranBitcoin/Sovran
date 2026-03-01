import { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { DebugBalancePanel } from 'components/blocks/DebugBalancePanel';
import { View } from 'components/ui/View/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from '@/components/ui/Text';
import { MOCK_NFC_SUCCESS_SATS } from '@/constants/wallet-header';
import {
  fmt,
  copyPopup,
  sendSuccessPopup,
  receiveSuccessPopup,
  nostrPaymentSentPopup,
  paymentCancelledPopup,
  nfcEcashSharedPopup,
  nfcPaymentSentPopup,
  nfcConnectionLostPopup,
  nfcSendFailedPopup,
  tokenRedeemedPopup,
  tokenAlreadyRedeemedPopup,
  tokenStillPendingPopup,
  tokenMixedStatesPopup,
  tokenCheckFailedPopup,
  tokenCannotCancelPopup,
  tokenCannotReclaimPopup,
  fundsReclaimedPopup,
  reclaimFailedPopup,
  tokenCannotCheckStatusPopup,
  tokenRedeemedByRecipientPopup,
  tokenPendingNotRedeemedPopup,
  transactionAlreadyCancelledPopup,
  transactionCancelledPopup,
  cameraPermissionPopup,
  insufficientBalancePopup,
  invalidAddressPopup,
  noClipboardAddressPopup,
  reservedProofsFreedPopup,
  reservedProofsFailedPopup,
  keyGeneratedPopup,
  keyGenerateFailedPopup,
  keysLoadFailedPopup,
  keyImportedPopup,
  keyImportFailedPopup,
  invalidKeyFormatPopup,
  mintsAddedPopup,
  noMintSelectedPopup,
  noMintsSelectedPopup,
  mintsAddFailedPopup,
  managerNotInitializedPopup,
  notImplementedPopup,
  comingSoonPopup,
  generalErrorPopup,
  newVersionPopup,
  passcodeNotMatchPopup,
  copyFailedPopup,
  openLinkFailedPopup,
  engagementUpdateFailedPopup,
  invalidPaymentRequestPopup,
  sendPaymentFailedPopup,
  cancelTransactionFailedPopup,
  operationNotFoundPopup,
  couldNotCancelPopup,
  operationInvalidStatePopup,
  invalidNostrTransportPopup,
  invalidRecipientPopup,
  noLightningAddressPopup,
  noPaymentRequestPopup,
  receiveFailedPopup,
  noUnitSetPopup,
  unsupportedTokenUnitPopup,
  receiveMintUpdatedPopup,
  receiveMintUpdateFailedPopup,
  walletNotReadyPopup,
  nfcErrorPopup,
  noQrCodeFoundPopup,
  qrScanFailedPopup,
  invalidTokenPopup,
  noWalletAvailablePopup,
  noApiKeyPopup,
  sendMessageFailedPopup,
  balanceRefreshedPopup,
  balanceRefreshFailedPopup,
  modelSwitchedPopup,
  photoPickerComingSoonPopup,
  routstrTopUpSuccessPopup,
  routstrWalletCreatedPopup,
  routstrInitializedPopup,
  routstrTransactionFailedPopup,
  devModePopup,
  deeplinkFailedPopup,
  rollbackSuccessPopup,
  rollbackPartialPopup,
} from '@/helper/popup';

type PopupEntry = { label: string; onPress: () => void };

const SECTIONS: { title: string; items: PopupEntry[] }[] = [
  {
    title: 'COPY',
    items: [
      { label: 'ecashToken', onPress: () => copyPopup('ecashToken') },
      { label: 'npub', onPress: () => copyPopup('npub') },
      { label: 'nsec', onPress: () => copyPopup('nsec') },
      { label: 'p2pk', onPress: () => copyPopup('p2pk') },
      { label: 'mnemonic', onPress: () => copyPopup('mnemonic') },
      { label: 'cashuMnemonic', onPress: () => copyPopup('cashuMnemonic') },
      { label: 'lightningAddress', onPress: () => copyPopup('lightningAddress') },
      { label: 'publicKey', onPress: () => copyPopup('publicKey') },
      { label: 'nip05', onPress: () => copyPopup('nip05') },
      { label: 'lud16', onPress: () => copyPopup('lud16') },
    ],
  },
  {
    title: 'FUNDS / PAYMENT',
    items: [
      { label: 'sendSuccess', onPress: () => sendSuccessPopup() },
      { label: 'receiveSuccess', onPress: () => receiveSuccessPopup({ amount: 500, unit: 'sat' }) },
      { label: 'nostrPaymentSent', onPress: () => nostrPaymentSentPopup() },
      { label: 'paymentCancelled', onPress: () => paymentCancelledPopup() },
    ],
  },
  {
    title: 'NFC',
    items: [
      { label: 'nfcEcashShared', onPress: () => nfcEcashSharedPopup() },
      {
        label: 'nfcPaymentSent',
        onPress: () =>
          nfcPaymentSentPopup({
            text: fmt`${{ amount: MOCK_NFC_SUCCESS_SATS, unit: 'sat' }} sent`,
            icon: 'custom:nfc-success',
            duration: 2600,
          }),
      },
      { label: 'nfcConnectionLost', onPress: () => nfcConnectionLostPopup() },
      {
        label: 'nfcSendFailed',
        onPress: () => nfcSendFailedPopup({ text: 'Tag removed too early.' }),
      },
      {
        label: 'nfcSendFailed (rollback)',
        onPress: () =>
          nfcSendFailedPopup({ rollbackFailed: true, text: 'Could not restore proofs.' }),
      },
    ],
  },
  {
    title: 'TOKEN STATUS',
    items: [
      { label: 'tokenRedeemed', onPress: () => tokenRedeemedPopup() },
      { label: 'tokenAlreadyRedeemed', onPress: () => tokenAlreadyRedeemedPopup() },
      { label: 'tokenStillPending', onPress: () => tokenStillPendingPopup() },
      {
        label: 'tokenMixedStates',
        onPress: () => tokenMixedStatesPopup({ spent: 3, unspent: 1, pending: 1, total: 5 }),
      },
      { label: 'tokenCheckFailed', onPress: () => tokenCheckFailedPopup() },
      { label: 'tokenCannotCancel', onPress: () => tokenCannotCancelPopup() },
      { label: 'tokenCannotReclaim', onPress: () => tokenCannotReclaimPopup() },
      { label: 'fundsReclaimed', onPress: () => fundsReclaimedPopup({ amount: 250, unit: 'sat' }) },
      {
        label: 'reclaimFailed',
        onPress: () => reclaimFailedPopup({ text: 'Swap rejected by mint.' }),
      },
      { label: 'tokenCannotCheckStatus', onPress: () => tokenCannotCheckStatusPopup() },
      { label: 'tokenRedeemedByRecipient', onPress: () => tokenRedeemedByRecipientPopup() },
      { label: 'tokenPendingNotRedeemed', onPress: () => tokenPendingNotRedeemedPopup() },
      { label: 'transactionAlreadyCancelled', onPress: () => transactionAlreadyCancelledPopup() },
      { label: 'transactionCancelled', onPress: () => transactionCancelledPopup() },
    ],
  },
  {
    title: 'CAMERA PERMISSIONS',
    items: [
      { label: 'camera granted', onPress: () => cameraPermissionPopup('granted') },
      { label: 'camera denied', onPress: () => cameraPermissionPopup('denied') },
      { label: 'camera blocked', onPress: () => cameraPermissionPopup('blocked') },
    ],
  },
  {
    title: 'BALANCE & ADDRESS',
    items: [
      {
        label: 'insufficientBalance',
        onPress: () => insufficientBalancePopup({ amount: 1000, unit: 'sat', fee: 2 }),
      },
      { label: 'invalidAddress', onPress: () => invalidAddressPopup({ address: 'abc123' }) },
      { label: 'noClipboardAddress', onPress: () => noClipboardAddressPopup() },
    ],
  },
  {
    title: 'RESERVED PROOFS',
    items: [
      {
        label: 'reservedProofsFreed',
        onPress: () => reservedProofsFreedPopup({ text: 'Reserved: 5\nRolled back: 2\nErrors: 0' }),
      },
      {
        label: 'reservedProofsFailed',
        onPress: () => reservedProofsFailedPopup({ text: 'Database locked.' }),
      },
    ],
  },
  {
    title: 'KEY MANAGEMENT',
    items: [
      { label: 'keyGenerated', onPress: () => keyGeneratedPopup() },
      { label: 'keyGenerateFailed', onPress: () => keyGenerateFailedPopup() },
      { label: 'keysLoadFailed', onPress: () => keysLoadFailedPopup() },
      { label: 'keyImported', onPress: () => keyImportedPopup() },
      {
        label: 'keyImportFailed',
        onPress: () => keyImportFailedPopup({ text: 'Decryption error.' }),
      },
      { label: 'invalidKeyFormat', onPress: () => invalidKeyFormatPopup() },
    ],
  },
  {
    title: 'MINTS',
    items: [
      { label: 'mintsAdded (success)', onPress: () => mintsAddedPopup({ added: 3 }) },
      { label: 'mintsAdded (partial)', onPress: () => mintsAddedPopup({ added: 2, failed: 1 }) },
      { label: 'noMintSelected', onPress: () => noMintSelectedPopup() },
      { label: 'noMintsSelected', onPress: () => noMintsSelectedPopup() },
      { label: 'mintsAddFailed', onPress: () => mintsAddFailedPopup() },
      { label: 'managerNotInitialized', onPress: () => managerNotInitializedPopup() },
    ],
  },
  {
    title: 'APP STATUS',
    items: [
      { label: 'notImplemented', onPress: () => notImplementedPopup() },
      { label: 'comingSoon', onPress: () => comingSoonPopup() },
      { label: 'generalError', onPress: () => generalErrorPopup() },
      { label: 'newVersion', onPress: () => newVersionPopup({ version: '2.1.0' }) },
      { label: 'passcodeNotMatch', onPress: () => passcodeNotMatchPopup() },
      { label: 'devMode (on)', onPress: () => devModePopup(true) },
      { label: 'devMode (off)', onPress: () => devModePopup(false) },
    ],
  },
  {
    title: 'CLIPBOARD & LINKS',
    items: [
      { label: 'copyFailed', onPress: () => copyFailedPopup() },
      { label: 'openLinkFailed', onPress: () => openLinkFailedPopup() },
    ],
  },
  {
    title: 'ENGAGEMENT',
    items: [
      { label: 'follow failed', onPress: () => engagementUpdateFailedPopup('follow') },
      { label: 'like failed', onPress: () => engagementUpdateFailedPopup('like') },
      { label: 'repost failed', onPress: () => engagementUpdateFailedPopup('repost') },
    ],
  },
  {
    title: 'SEND & PAYMENT ERRORS',
    items: [
      { label: 'invalidPaymentRequest', onPress: () => invalidPaymentRequestPopup() },
      {
        label: 'sendPaymentFailed',
        onPress: () => sendPaymentFailedPopup({ text: 'Network timeout.' }),
      },
      {
        label: 'cancelTransactionFailed',
        onPress: () => cancelTransactionFailedPopup({ text: 'Operation already finalized.' }),
      },
      { label: 'operationNotFound', onPress: () => operationNotFoundPopup() },
      { label: 'couldNotCancel', onPress: () => couldNotCancelPopup({ text: 'Already spent.' }) },
      {
        label: 'operationInvalidState',
        onPress: () => operationInvalidStatePopup({ state: 'finalized' }),
      },
      { label: 'invalidNostrTransport', onPress: () => invalidNostrTransportPopup() },
      { label: 'invalidRecipient', onPress: () => invalidRecipientPopup() },
      { label: 'noLightningAddress', onPress: () => noLightningAddressPopup() },
      { label: 'noPaymentRequest', onPress: () => noPaymentRequestPopup() },
    ],
  },
  {
    title: 'RECEIVE',
    items: [
      {
        label: 'receiveFailed',
        onPress: () => receiveFailedPopup({ text: 'Token already spent.' }),
      },
      { label: 'noUnitSet', onPress: () => noUnitSetPopup() },
      { label: 'unsupportedTokenUnit', onPress: () => unsupportedTokenUnitPopup({ unit: 'eur' }) },
      { label: 'receiveMintUpdated', onPress: () => receiveMintUpdatedPopup() },
      { label: 'receiveMintUpdateFailed', onPress: () => receiveMintUpdateFailedPopup() },
    ],
  },
  {
    title: 'NFC ERRORS',
    items: [
      { label: 'walletNotReady', onPress: () => walletNotReadyPopup() },
      {
        label: 'nfcError',
        onPress: () =>
          nfcErrorPopup({ title: 'NFC Read Failed', message: 'Tag was removed during read.' }),
      },
    ],
  },
  {
    title: 'CAMERA & QR',
    items: [
      { label: 'noQrCodeFound', onPress: () => noQrCodeFoundPopup() },
      { label: 'qrScanFailed', onPress: () => qrScanFailedPopup() },
    ],
  },
  {
    title: 'MESSAGES / AI',
    items: [
      { label: 'invalidToken', onPress: () => invalidTokenPopup() },
      { label: 'noWalletAvailable', onPress: () => noWalletAvailablePopup() },
      { label: 'noApiKey', onPress: () => noApiKeyPopup() },
      { label: 'sendMessageFailed', onPress: () => sendMessageFailedPopup() },
      {
        label: 'balanceRefreshed',
        onPress: () => balanceRefreshedPopup({ balance: '12,500 sats' }),
      },
      {
        label: 'balanceRefreshFailed',
        onPress: () => balanceRefreshFailedPopup({ text: 'API error.' }),
      },
      { label: 'modelSwitched', onPress: () => modelSwitchedPopup({ modelName: 'GPT-4o' }) },
      { label: 'photoPickerComingSoon', onPress: () => photoPickerComingSoonPopup() },
    ],
  },
  {
    title: 'ROUTSTR',
    items: [
      {
        label: 'routstrTopUpSuccess',
        onPress: () => routstrTopUpSuccessPopup({ balance: '5,000 sats' }),
      },
      {
        label: 'routstrWalletCreated',
        onPress: () => routstrWalletCreatedPopup({ balance: '1,000 sats' }),
      },
      {
        label: 'routstrInitialized',
        onPress: () => routstrInitializedPopup({ balance: '500 sats' }),
      },
      { label: 'routstrInitialized (no balance)', onPress: () => routstrInitializedPopup() },
      {
        label: 'routstrTransactionFailed',
        onPress: () => routstrTransactionFailedPopup({ text: 'Mint unreachable.' }),
      },
    ],
  },
  {
    title: 'DEEPLINK',
    items: [
      {
        label: 'deeplinkFailed',
        onPress: () => deeplinkFailedPopup({ text: 'Unrecognized URI scheme.' }),
      },
    ],
  },
  {
    title: 'PENDING ECASH',
    items: [
      { label: 'rollbackSuccess (1)', onPress: () => rollbackSuccessPopup({ count: 1 }) },
      { label: 'rollbackSuccess (3)', onPress: () => rollbackSuccessPopup({ count: 3 }) },
      {
        label: 'rollbackPartial (warning)',
        onPress: () => rollbackPartialPopup({ success: 2, failed: 1, total: 3 }),
      },
      {
        label: 'rollbackPartial (all failed)',
        onPress: () => rollbackPartialPopup({ success: 0, failed: 3, total: 3 }),
      },
    ],
  },
];

function DevPopupPanelComponent() {
  return (
    <View className="px-4 pb-2" style={styles.container}>
      <DebugBalancePanel />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.buttonRow}>
              {section.items.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={styles.popupButton}
                  onPress={item.onPress}>
                  <Text style={styles.buttonText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export const DevPopupPanel = memo(DevPopupPanelComponent);

const styles = StyleSheet.create({
  container: { gap: 8, flex: 1 },
  scroll: { flex: 1 },
  section: { gap: 4, marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 12 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  popupButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
  },
});
