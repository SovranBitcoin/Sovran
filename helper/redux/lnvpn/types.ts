export interface VpnOrder {
  WireguardConfig?: string[];
  ordered_at?: string;
  expiry_date?: string;
  [key: string]: any;
}

export interface Vpn {
  location: string;
  duration: string;
  duration_code: string | number;
  cc?: string;
  created_at: string;
  payment_hash: string;
  payment_request: string;
  order?: VpnOrder;
}

export interface VpnState {
  vpns: Vpn[];
}
