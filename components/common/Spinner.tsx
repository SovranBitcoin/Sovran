import React from 'react';
import Icon from 'assets/icons';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

export function Spinner({ size = 8, style }: { size?: number; style?: any }) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <Icon
      name="ant-design:loading-outlined"
      size={size}
      color={theme.greys[100]}
      style={style}
      spin={{
        delay: 0,
        duration: 1000,
        outputRange: ['0deg', '360deg'],
        easing: 'linear',
      }}
    />
  );
}
