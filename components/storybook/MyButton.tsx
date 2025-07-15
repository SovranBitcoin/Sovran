import React from 'react';
import { Pressable, Text } from 'react-native';

export interface MyButtonProps {
  text: string;
  onPress?: () => void;
}

export const MyButton = ({ text, onPress }: MyButtonProps) => (
  <Pressable onPress={onPress} style={{ padding: 12, borderRadius: 4, backgroundColor: '#3478f6' }}>
    <Text style={{ color: '#fff', textAlign: 'center' }}>{text}</Text>
  </Pressable>
);
