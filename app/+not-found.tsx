import React from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Link, Stack } from 'expo-router';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <VStack align="center" justify="center" className="flex-1" style={{ padding: 20 }}>
        <Text id="not_found_screen_title" className="text-xl font-bold">
          {"This screen doesn't exist."}
        </Text>

        <Spacer size={16} />
        <Link href="/" style={{ paddingVertical: 16 }}>
          <Text className="text-base text-[#2e78b7]" id="not_found_screen_home_button">
            Go to home screen!
          </Text>
        </Link>
      </VStack>
    </>
  );
}
