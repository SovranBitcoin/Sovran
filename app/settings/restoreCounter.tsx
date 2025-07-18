import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { Button } from 'components/common/Button';
import { Text } from 'components/common/Text';
import Container from 'components/layout/Container';
import { restoreCounter } from 'helper/cashuClient';
import { increaseCounterV2 } from 'helper/redux/cashu';
import { runWithAnimationFrame } from '../onboard/new';
import { ScrollView } from 'react-native';
import { RootState } from 'helper/redux/store/reducer';
import { MintKeyset } from '@cashu/cashu-ts';

export default function ModalScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const keysets = useSelector((state: RootState) => state.cashu?.keysets);
  const profileId = useSelector((state: RootState) => state.nostr?.currentProfile?.id);

  async function restore({ keyset, mintUrl }: { keyset: any; mintUrl: string }) {
    const counter = await restoreCounter({
      keyset,
      mintUrl,
    });

    store.dispatch(
      increaseCounterV2({
        profileId,
        mintUrl,
        keysetId: keyset.id,
        amount: counter,
      })
    );
  }

  const handleRestore = (keyset: MintKeyset, mintUrl: string) => {
    return () => runWithAnimationFrame(restore, setIsLoading)({ keyset, mintUrl });
  };

  if (!!keysets && !!profileId) {
    return null;
  }

  return (
    <Container>
      <ScrollView>
        {Object.entries(keysets).map(([mintUrl, keysetArray]) => (
          <React.Fragment key={mintUrl}>
            <Text>{mintUrl}</Text>
            {keysetArray?.map((keyset) => (
              <React.Fragment key={keyset.id}>
                <Text>{keyset.id}</Text>
                <Button
                  variant="primary"
                  onPress={handleRestore(keyset, mintUrl)}
                  text={isLoading ? 'Restoring Keyset...' : 'Restore'}
                  loading={isLoading}
                />
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </ScrollView>
    </Container>
  );
}
