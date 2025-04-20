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

export function CloudWallet() {
  return (
    <CachedImage
      style={{ width: 48, height: 48 }}
      source={require('assets/images/cloud_wallet.png')}
    />
  );
}

export function Wallet() {
  return (
    <CachedImage style={{ width: 48, height: 48 }} source={require('assets/images/wallet.png')} />
  );
}

export function Vault() {
  return (
    <CachedImage style={{ width: 48, height: 48 }} source={require('assets/images/vault.png')} />
  );
}
