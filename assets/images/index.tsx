import React from 'react';
import CachedImage from '../../components/common/Image';

export function Cashews({ style, ...props }) {
  return (
    <CachedImage
      source={require('assets/images/cashews.png')}
      style={[{ transform: [{ rotate: '90deg' }] }, style]}
      {...props}
    />
  );
}
