/**
 * @fileoverview RouteA - Profile deletion confirmation
 *
 * @module components/blocks/sheets/delete/routes/route-a
 *
 * @description
 * Displays deletion warnings and confirmation button. Shows mnemonic recovery
 * limitations and performs complete app reset with reload on confirmation.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: Closes after destructive action (app reset)
 * - Close: App reset and reload (no return)
 *
 * **Data:**
 * - Payload: None (no payload needed)
 * - Params: None (single route)
 *
 * **Flow:** Display warnings → user confirms → reset app → reload
 *
 * @see {@link ./index}
 */

import { Button } from 'components/ui/Button';
import { Card } from 'components/ui/Card';
import { Spacer, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { resetApp } from 'redux/store';
import * as Updates from 'expo-updates';
import React from 'react';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { useDispatch } from 'react-redux';

/**
 * RouteA Component
 *
 * @component
 * @param {RouteScreenProps<'delete-router', 'route-a'>} props
 * @returns {JSX.Element}
 */
const RouteA = ({}: RouteScreenProps<'delete-router', 'route-a'>) => {
  const dispatch = useDispatch();

  /**
   * Handles profile deletion
   *
   * @async
   * @description Resets app state and reloads application
   *
   * **Process:** dispatch(resetApp()) → Updates.reloadAsync()
   * **Effects:** Complete app reset, data loss, app reload
   */
  const handleDeleteProfile = async () => {
    try {
      await dispatch(resetApp());
      await Updates.reloadAsync();
    } catch {}
  };

  return (
    <View className="bg-primary-950" style={{ padding: 20 }}>
      <Text size={18} style={{ marginBottom: 20 }}>
        Are you sure you want to delete your profile?
      </Text>
      <Text style={{ marginBottom: 20 }}>
        This action cannot be reversed. Please ensure you have backed up your mnemonic phrase.
      </Text>
      <Card
        variant="warning"
        message="There is no guarantee that your mnemonic phrase will allow you to recover your funds. If you were a TestFlight user its possible your recovery phrase won't restore all your funds."
      />
      <Spacer size={12} />
      <Button text="Delete everything" onPress={handleDeleteProfile} variant={'primary'} />
    </View>
  );
};

export default RouteA;
