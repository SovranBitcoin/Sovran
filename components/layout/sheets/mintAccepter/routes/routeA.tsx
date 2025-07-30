import React from 'react';

import { ButtonHandler } from 'components/common/ButtonHandler';
import { StyledText, Text } from 'components/common/Text';
import { View } from 'components/common/View';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useDispatch, useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { addMintsAction } from 'helper/redux/cashu';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import opacity from 'hex-color-opacity';
import { getMint } from 'helper/cashuClient';
import { showMessage } from 'helper/popup/popups';

// eslint-disable-next-line no-empty-pattern
function RouteA({}: RouteScreenProps<'mint-accepter', 'route-a'>) {
  const theme = useSelector(memoizedGetTheme);
  const ref = useSheetRef('mint-accepter');
  const payload = useSheetPayload('mint-accepter');
  const dispatch = useDispatch();

  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[800],
        padding: 8,
        paddingTop: 24,
      }}>
      <Text
        size={24}
        style={{
          fontSize: 20,
          fontFamily: 'OverpassHeavy',
          color: greys(theme)[0],
          marginLeft: 16,
          textAlign: 'center',
          marginBottom: 16,
        }}>
        Do you want to trust{' '}
        <View>
          <StyledText
            primary
            style={{
              fontFamily: 'OverpassHeavy',
              fontSize: 20,
              marginBottom: -5.5,
            }}>
            {payload.mint.replace('https://', '').replace('http://', '')}
          </StyledText>
        </View>
        ?
      </Text>
      <ButtonHandler
        colors={[
          opacity(greys(theme)[800], 0),
          opacity(greys(theme)[800], 0.75),
          opacity(greys(theme)[800], 0.9),
          greys(theme)[800],
        ]}
        buttons={[
          {
            text: "Don't trust",
            variant: 'secondary',
            onPress: async () => {
              ref.current.hide({
                mint: [payload.mint],
                trusted: false,
              });
            },
          },
          {
            text: 'Trust',
            variant: 'primary',
            onPress: async () => {
              // Check for keyset ID collisions before adding the mint
              const mintRes = await getMint({ mintUrl: payload.mint, forceRefresh: true });
              if (mintRes.isErr()) {
                console.log('mintRes.error.message', mintRes.error.message);
                console.error(mintRes.error.message);
                showMessage(mintRes.error.message);
                if (mintRes.error.message === 'colliding_keyset_id') {
                  ref.current.hide({
                    mint: [payload.mint],
                    trusted: false,
                    error: 'This mint has conflicting keyset IDs with existing mints',
                  });
                }
                return;
              }

              dispatch(
                addMintsAction({
                  profileId: store.getState().nostr?.currentProfile?.id,
                  mintUrls: [payload.mint],
                })
              );
              ref.current.hide({
                mint: [payload.mint],
                trusted: true,
              });
            },
          },
        ]}
        style={{ marginTop: 16 }}
      />
    </View>
  );
}

export default RouteA;
