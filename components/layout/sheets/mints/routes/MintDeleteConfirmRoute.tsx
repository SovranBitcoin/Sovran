import React, { useState } from 'react';
import { useSheetRouteParams } from 'react-native-actions-sheet';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { useDispatch, useSelector } from 'react-redux';
import { Button } from 'components/common/Button';
import { Card } from 'components/common/Card';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { memoizedGetBalance } from 'helper/redux/cashu/selectors';
import { removeMintsAction } from 'helper/redux/cashu/actions';
import { showMessage } from 'helper/popup/popups';
import { RootState } from 'helper/redux/store/reducer';
import { runWithAnimationFrame } from 'app/onboard/new';

const MintDeleteConfirmRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const dispatch = useDispatch();
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useSheetRouter('mint');
  const routeParams = useSheetRouteParams('mint', 'mintDeleteConfirm') as
    | { mintUrl?: string }
    | undefined;
  const mintUrl = routeParams?.mintUrl;

  const balanceSelector = memoizedGetBalance('sat', mintUrl || '');
  const balance = useSelector(balanceSelector);

  const allProofs = useSelector(
    (state: RootState) =>
      (mintUrl && state.cashu.profiles[state.nostr.currentProfile.id]?.proofs?.[mintUrl]) || []
  );

  const mintInfo = useSelector((state: RootState) =>
    mintUrl ? state.cashu?.info?.[mintUrl] : undefined
  );

  const handleDeleteMint = () => {
    console.log('[MintDeleteConfirmRoute] delete clicked', { mintUrl });
    if (!mintUrl) {
      showMessage('Error: No mint URL provided', {}, { emoji: '❌' });
      return;
    }

    try {
      console.log('[MintDeleteConfirmRoute] check proofs/balance', {
        proofsLength: allProofs.length,
        balance,
      });
      if (allProofs.length > 0 || balance > 0) {
        showMessage(
          'Cannot delete mint with remaining balance. Please spend or transfer your funds first.',
          {},
          { emoji: '⚠️' },
          () => router?.goBack()
        );
        return;
      }

      const run = runWithAnimationFrame(async () => {
        console.log('[MintDeleteConfirmRoute] dispatch removeMintsAction');
        await dispatch(
          removeMintsAction({
            profileId: currentProfile.id,
            mints: [mintUrl],
          })
        );
        console.log('[MintDeleteConfirmRoute] dispatch done');
        showMessage('Mint deleted successfully', {}, { emoji: '✅' }, () => router?.goBack());
      }, setIsDeleting);
      run();
    } catch (error) {
      console.error('Error deleting mint:', error);
      showMessage('Failed to delete mint', {}, { emoji: '❌' }, () => router?.goBack());
    }
  };

  const mintName = mintInfo?.name || mintUrl;

  // Keeping counters intact as requested; no need to load mints array here

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
          loading={isDeleting}
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

export default MintDeleteConfirmRoute;
