import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { DebugBalancePanel } from 'components/blocks/DebugBalancePanel';
import { View } from 'components/ui/View/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from '@/components/ui/Text';
import { AmountFormatter } from '@/components/ui/AmountFormatter';
import { NfcSuccessConfirmCircleIcon } from '@/components/overlays/NfcSuccessOverlay';
import { popup } from '@/helper/popup';
import { MOCK_NFC_SUCCESS_SATS } from '@/constants/wallet-header';

function DevPopupPanelComponent() {
  return (
    <View className="px-4 pb-2" style={styles.container}>
      <DebugBalancePanel />

      <TouchableOpacity
        onPress={() =>
          popup({
            message: 'Payment sent',
            text: (
              <Text style={{ alignItems: 'center' }}>
                <AmountFormatter
                  size={12}
                  weight="heavy"
                  amount={MOCK_NFC_SUCCESS_SATS}
                  unit="sat"
                />
                <Text size={12} weight="heavy">
                  {' sent'}
                </Text>
              </Text>
            ),
            variant: 'sheet',
            duration: 2600,
            icon: <NfcSuccessConfirmCircleIcon color="#22c55e" size={88} startDelayMs={0} />,
          })
        }
        style={styles.nfcPreviewButton}>
        <Text style={styles.buttonText}>Preview NFC success ({MOCK_NFC_SUCCESS_SATS} sats)</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Toast Variants</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({ message: 'Success!', text: 'Operation completed.', type: 'success' })
          }>
          <Text style={styles.buttonText}>Success</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({ message: 'Warning', text: 'Please check your input.', type: 'warning' })
          }>
          <Text style={styles.buttonText}>Warning</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() => popup({ message: 'Error', text: 'Something went wrong.', type: 'error' })}>
          <Text style={styles.buttonText}>Error</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() => popup({ message: 'Info', text: 'Just a heads up.', type: 'info' })}>
          <Text style={styles.buttonText}>Info</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Toast Options</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.popupButton} onPress={() => popup('ecash_token_copied')}>
          <Text style={styles.buttonText}>Message Code</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() => popup({ message: 'Custom Emoji', emoji: '🔑', type: 'success' })}>
          <Text style={styles.buttonText}>Custom Emoji</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({ message: 'Quick', text: 'Gone in 1s.', type: 'info', duration: 1000 })
          }>
          <Text style={styles.buttonText}>Short Duration</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'With Callback',
              type: 'success',
              onClose: () => console.log('[popup] onClose fired'),
            })
          }>
          <Text style={styles.buttonText}>onClose</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Sheet Variants</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Basic Sheet',
              text: 'Detached bottom sheet with one button.',
              variant: 'sheet',
              buttons: [{ text: 'OK' }],
            })
          }>
          <Text style={styles.buttonText}>Basic</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Multiple Actions',
              text: 'Primary action + secondary dismiss.',
              variant: 'sheet',
              buttons: [
                {
                  text: 'Confirm',
                  onPress: () => popup({ message: 'Confirmed!', type: 'success' }),
                },
                { text: 'Cancel' },
              ],
            })
          }>
          <Text style={styles.buttonText}>Multi-Button</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Navigate',
              text: 'Button navigates to a page.',
              variant: 'sheet',
              buttons: [{ text: 'Go to Theme', page: 'settings-pages/theme' }],
            })
          }>
          <Text style={styles.buttonText}>Page Nav</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Custom Emoji',
              text: 'Sheet with custom emoji override.',
              emoji: '🛡️',
              variant: 'sheet',
              buttons: [{ text: 'Cool' }],
            })
          }>
          <Text style={styles.buttonText}>Custom Emoji</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Non-Dismissable',
              text: 'You must press the button to close.',
              variant: 'sheet',
              dismissable: false,
              buttons: [{ text: 'I understand' }],
            })
          }>
          <Text style={styles.buttonText}>Non-Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'With onClose',
              text: 'onClose callback fires on any close path.',
              variant: 'sheet',
              buttons: [{ text: 'Close' }],
              onClose: () => console.log('[popup] sheet onClose fired'),
            })
          }>
          <Text style={styles.buttonText}>onClose</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.popupButton}
          onPress={() =>
            popup({
              message: 'Auto-Dismiss Sheet',
              text: 'This sheet closes automatically after 3 seconds.',
              variant: 'sheet',
              duration: 3000,
            })
          }>
          <Text style={styles.buttonText}>Duration 3s</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export const DevPopupPanel = memo(DevPopupPanelComponent);

const styles = StyleSheet.create({
  container: { gap: 8 },
  nfcPreviewButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#fff', fontSize: 14 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  popupButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
  },
});
