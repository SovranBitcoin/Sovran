import React from 'react';

import { ButtonHandler } from 'components/common/ButtonHandler';
import { StyledText, Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { addMintsAction } from 'helper/redux/cashu';
import { useSheetRef, useSheetRouter } from 'react-native-actions-sheet';
import opacity from 'hex-color-opacity';

export function RouteA({ payload }) {
  const theme = useSelector(memoizedGetTheme);
  const router = useSheetRouter('mint-accepter');
  const ref = useSheetRef('mint-accepter');

  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[1800],
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
          opacity(greys(theme)[1800], 0),
          opacity(greys(theme)[1800], 0.75),
          opacity(greys(theme)[1800], 0.9),
          greys(theme)[1800],
        ]}
        buttons={[
          {
            text: "Don't trust",
            variant: 'secondary',
            icon: null,
            onPress: () => {
              ref.current.hide({
                action: 'reject',
                mint: [payload.mint],
                trusted: false,
              });
            },
          },
          {
            text: 'Trust',
            variant: 'primary',
            icon: null,
            onPress: () => {
              store.dispatch(
                addMintsAction({
                  profileId: store.getState().nostr?.currentProfile?.id,
                  mintUrls: [payload.mint],
                })
              );
              ref.current.hide({
                action: 'trust',
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
