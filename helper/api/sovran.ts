const BASE_URL = 'https://esim.sovran.cash/api';

export interface ProductPackage {
  packageCode: number | string;
  slug: string;
  name: string;
  price: number;
  currencyCode: string;
  volume: number;
  smsStatus: string;
  dataType: string;
  unusedValidTime: number;
  duration: number;
  durationUnit: string;
  location: string;
  description: string;
  activeType: string;
  favourite: boolean;
  retailPrice: number;
  speed: string;
}

export interface QuoteResponse {
  sats: number;
  request: string;
}

export interface OrderResponse {
  obj?: {
    orderNo: string;
    esimList?: any[];
  };
  [key: string]: any;
}

export interface SearchResult {
  profileEvent: string;
  [key: string]: any;
}

export const fetchProducts = async () => {
  const res = await fetch(`${BASE_URL}/api/products`);
  return res.json() as Promise<{ success: boolean; obj?: { packageList: ProductPackage[] } }>;
};

export const fetchQuote = async ({
  packageCode,
  iccid,
  type,
}: {
  packageCode: string | number;
  iccid?: string;
  type?: 'TOPUP' | 'BASE';
}) => {
  const params = new URLSearchParams({ packageCode: String(packageCode) });
  if (type === 'TOPUP' && iccid) {
    params.append('type', 'TOPUP');
    params.append('iccid', iccid);
  }
  const res = await fetch(`${BASE_URL}/quote?${params}`);
  return res.json() as Promise<QuoteResponse>;
};

export const fetchOrderData = async ({
  request,
  packageCode,
  slug,
  iccid,
  type,
}: {
  request: string;
  packageCode: string | number;
  slug?: string;
  iccid?: string;
  type?: 'TOPUP';
}) => {
  const params = new URLSearchParams({ request, packageCode: String(packageCode) });
  if (type === 'TOPUP' && slug && iccid) {
    params.append('slug', slug);
    params.append('iccid', iccid);
    params.append('type', 'TOPUP');
  }
  const res = await fetch(`${BASE_URL}/order?${params}`);
  return res.json() as Promise<OrderResponse>;
};

export const fetchEsimData = async ({ orderNo }: { orderNo: string }) => {
  const res = await fetch(`${BASE_URL}/order/query?orderNo=${orderNo}`);
  return res.json() as Promise<OrderResponse>;
};

export const searchUsers = async ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/search?${params}`);
  return res.json() as Promise<{ results: SearchResult[] }>;
};

export const fetchVpnInvoice = async ({ duration }: { duration: string | number }) => {
  const res = await fetch(`${BASE_URL}/vpn/invoice?duration=${duration}`);
  return res.json() as Promise<{ payment_hash: string; payment_request: string }>;
};

export const fetchVpnCountries = async () => {
  const res = await fetch(`${BASE_URL}/vpn/countries`);
  return res.json() as Promise<any>;
};

export const activateVpn = async ({
  paymentHash,
  location,
}: {
  paymentHash: string;
  location: string;
}) => {
  const params = new URLSearchParams({ paymentHash, location });
  const res = await fetch(`${BASE_URL}/vpn/activate?${params}`);
  return res.json() as Promise<any>;
};

export const auditMint = async ({ mintUrl }: { mintUrl: string }) => {
  const res = await fetch(`${BASE_URL}/mint/audit?mintUrl=${mintUrl}`);
  return res.json() as Promise<any>;
};
