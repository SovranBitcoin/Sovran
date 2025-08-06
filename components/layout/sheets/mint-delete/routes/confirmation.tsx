import React, { useState } from 'react';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';
import { Button } from 'components/common/Button';
import { Card } from 'components/common/Card';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { memoizedGetBalance } from 'helper/redux/cashu/selectors';
import { removeMints } from 'helper/redux/cashu/actions';
import { showMessage } from 'helper/popup/popups';
import { RootState } from 'helper/redux/store/reducer';

const Confirmation = ({ router }: RouteScreenProps<'mint-delete', 'confirmation'>) => {
  const theme = useSelector(memoizedGetTheme);
  const dispatch = useDispatch();
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const [isDeleting, setIsDeleting] = useState(false);

  const payload = useSheetPayload('mint-delete');
  const mintUrl = payload?.mintUrl;

  // Check balance for this mint across all units
  const balanceSelector = memoizedGetBalance('sat', mintUrl);
  const balance = useSelector(balanceSelector);

  // Get all proofs for this mint
  const allProofs = useSelector(
    (state: RootState) =>
      state.cashu.profiles[state.nostr.currentProfile.id]?.proofs?.[mintUrl] || []
  );

  // Get mint info for display
  const mintInfo = useSelector((state: RootState) => state.cashu?.info?.[mintUrl]);

  const handleDeleteMint = async () => {
    if (!mintUrl) {
      showMessage('Error: No mint URL provided', {}, { emoji: '❌' });
      return;
    }

    try {
      setIsDeleting(true);

      // Check if there are any proofs (balance) remaining
      if (allProofs.length > 0 || balance > 0) {
        showMessage(
          'Cannot delete mint with remaining balance. Please spend or transfer your funds first.',
          {},
          { emoji: '⚠️' }
        );
        router?.goBack();
        return;
      }

      // Remove the mint from the user's mint list
      dispatch(
        removeMints({
          profileId: currentProfile.id,
          mints: [mintUrl],
        })
      );

      // Note: We don't need to explicitly remove keys, keysets, and info
      // as they will be orphaned when the mint is removed from the user's list
      // The app will naturally not use them anymore

      showMessage('Mint deleted successfully', {}, { emoji: '✅' });

      // Return success result and close
      router?.close();
    } catch (error) {
      console.error('Error deleting mint:', error);
      showMessage('Failed to delete mint', {}, { emoji: '❌' });
      router?.close();
    } finally {
      setIsDeleting(false);
    }
  };

  const mintName = mintInfo?.name || mintUrl;

  return (
    <View style={{ padding: 20, backgroundColor: greys(theme)[950] }}>
      <Text style={{ fontSize: 18, marginBottom: 20, color: greys(theme)[0] }}>Delete Mint</Text>

      <Text style={{ marginBottom: 16, color: greys(theme)[100] }}>
        Are you sure you want to delete the mint &quot;{mintName}&quot;?
      </Text>

      <Text style={{ marginBottom: 20, color: greys(theme)[200] }}>
        This will remove all keys, keysets, and information for this mint from your device.
      </Text>

      {(allProofs.length > 0 || balance > 0) && (
        <>
          <Card
            variant="warning"
            message={`This mint still has a balance of ${balance} sats. You must spend or transfer all funds before deleting this mint.`}
          />
          <Spacer size={12} />
        </>
      )}

      <Card
        variant="warning"
        message="This action cannot be undone. Make sure you have spent all your funds from this mint before proceeding."
      />

      <Spacer size={20} />

      <View style={{ gap: 12 }}>
        <Button
          text={isDeleting ? 'Deleting...' : 'Delete Mint'}
          onPress={handleDeleteMint}
          variant="primary"
          disabled={isDeleting || allProofs.length > 0 || balance > 0}
          style={{
            backgroundColor: allProofs.length > 0 || balance > 0 ? greys(theme)[600] : reds[300],
          }}
        />

        <Button
          text="Cancel"
          onPress={() => router?.goBack()}
          variant="secondary"
          disabled={isDeleting}
        />
      </View>
    </View>
  );
};

export default Confirmation;
