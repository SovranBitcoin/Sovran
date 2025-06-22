import { Alert } from 'react-native';
import WireGuardVpnModule, { WireGuardConfig, WireGuardStatus } from 'react-native-wireguard-vpn';

export const initializeVpn = async () => {
  try {
    await WireGuardVpnModule.initialize();
    Alert.alert('VPN Initialized');
  } catch (error) {
    Alert.alert('Initialization Failed', JSON.stringify(error));
  }
};

export const connectVpn = async (config: WireGuardConfig) => {
  try {
    await WireGuardVpnModule.connect(config);
    Alert.alert('VPN Connected');
  } catch (error) {
    Alert.alert('Connection Failed', JSON.stringify(error));
  }
};

export const disconnectVpn = async () => {
  try {
    await WireGuardVpnModule.disconnect();
    Alert.alert('VPN Disconnected');
  } catch (error) {
    Alert.alert('Disconnection Failed', JSON.stringify(error));
  }
};

export const getVpnStatus = async (): Promise<WireGuardStatus | null> => {
  try {
    const status = await WireGuardVpnModule.getStatus();
    Alert.alert('VPN Status', JSON.stringify(status));
    return status;
  } catch (error) {
    Alert.alert('Status Error', JSON.stringify(error));
    return null;
  }
};

export const parseWireGuardConfig = (lines: string[]): WireGuardConfig => {
  const kv: Record<string, string> = {};
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
      return;
    }
    const [key, value] = trimmed.split('=');
    if (key && value) {
      kv[key.trim()] = value.trim();
    }
  });

  const endpoint = kv['Endpoint'] || '';
  const [serverAddress, serverPortStr] = endpoint.split(':');

  return {
    privateKey: kv['PrivateKey'],
    publicKey: kv['PublicKey'],
    serverAddress,
    serverPort: parseInt(serverPortStr || '51820', 10),
    allowedIPs: (kv['AllowedIPs'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dns: kv['DNS'] ? [kv['DNS']] : undefined,
    mtu: kv['MTU'] ? parseInt(kv['MTU'], 10) : undefined,
    presharedKey: kv['PresharedKey'] || undefined,
  } as WireGuardConfig;
};
