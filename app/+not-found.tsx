import React from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { Link, Stack } from 'expo-router';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center p-5">
        <Text id="not_found_screen_title" className="text-xl font-bold">
          {"This screen doesn't exist."}
        </Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-base text-[#2e78b7]" id="not_found_screen_home_button">
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}
