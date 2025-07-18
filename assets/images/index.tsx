import React from 'react';
import CachedImage from '../../components/common/Image';

export function Cashews({ style, ...props }) {
  return (
    <CachedImage
      source={require('./cashews.png')}
      style={[{ transform: [{ rotate: '90deg' }] }, style]}
      {...props}
    />
  );
}
