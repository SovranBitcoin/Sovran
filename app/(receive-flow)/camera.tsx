/**
 * @fileoverview Receive flow camera route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 * CameraScreen uses machine.scan directly.
 */

import React from 'react';
import { Stack } from 'expo-router';

import { CameraScreen } from '@/features/camera';

export default function Camera() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Scan QR',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
        }}
      />
      <CameraScreen />
    </>
  );
}
