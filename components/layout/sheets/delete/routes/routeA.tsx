import { Button } from 'components/common/Button';
import { Card } from 'components/common/Card';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { resetApp } from 'helper/redux/store';
import * as Updates from 'expo-updates';
import React from 'react';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';

// eslint-disable-next-line no-empty-pattern
const RouteA = ({}: RouteScreenProps<'example-sheet-with-router', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const dispatch = useDispatch();
  const handleDeleteProfile = async () => {
    try {
      await dispatch(resetApp());
      await Updates.reloadAsync();
    } catch {}
  };

  return (
    <View style={{ padding: 20, backgroundColor: theme.greys[2300] }}>
      <Text style={{ fontSize: 18, marginBottom: 20 }}>
        Are you sure you want to delete your profile?
      </Text>
      <Text style={{ marginBottom: 20 }}>
        This action cannot be reversed. Please ensure you have backed up your mnemonic phrase.
      </Text>
      <Card
        variant="warning"
        message="There is no guarantee that your mnemonic phrase will allow you to recover your funds. If you were a TestFlight user its possible your recovery phrase won't restore all your funds."
      />
      <Button text="Delete everything" onPress={handleDeleteProfile} variant={'primary'} />
    </View>
  );
};

export default RouteA;
