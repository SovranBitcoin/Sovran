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

export function AnonIcon() {
  return (
    <CachedImage
      style={{ width: 48, height: 48, opacity: 0.7 }}
      source={require('assets/images/anon.png')}
    />
  );
}
