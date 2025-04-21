import React from 'react';

import { Button } from 'components/common/Button';
import { StyledText, Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { addMintsAction } from 'helper/redux/cashu';
import { useSheetRouter } from 'react-native-actions-sheet';

export function RouteA({ payload }) {
  const theme = useSelector(memoizedGetTheme);
  const router = useSheetRouter('mint-accepter');
  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[1800],
        padding: 8,
        paddingVertical: 32,
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
      <Button
        text="Don't trust"
        variant="secondary"
        icon={null}
        style={{}}
        camera={false}
        noPadding={false}
        onPress={() => {
          router?.close();
        }}
      />
      <Button
        text="Trust"
        variant="primary"
        icon={null}
        style={{}}
        camera={false}
        noPadding={false}
        onPress={() => {
          store.dispatch(
            addMintsAction({
              profileId: store.getState().nostr?.currentProfile?.id,
              mintUrls: [payload.mint],
            })
          );

          router?.close();
        }}
      />
    </View>
  );
}

export default RouteA;
