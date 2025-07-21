import { GetInfoResponse } from '@cashu/cashu-ts';
import { ok, err, Result } from 'neverthrow';

const BASE_URL = 'https://api.sovran.money/api';

export const PRICELIST_URL = `wss://ws.sovran.money`;

export interface UserStats {
  pubkey: string;
  follows_count: number;
  followers_count: number;
  note_count: number;
  long_form_note_count: number;
  reply_count: number;
  time_joined: number;
  relay_count: number;
  total_zap_count: number;
  total_satszapped: number;
  media_count: number;
  content_zap_count: number;
}

export interface UserProfile {
  profileEvent: string;
  name: string;
  displayName: string;
  about?: string;
  banner?: string;
  picture: string;
  image: string;
  website?: string;
  lud16: string;
  lud06?: string;
  nip05?: string;
  nip05Valid: boolean;
  hasNip05Conflict: boolean;
  created_at: number;
  pubkey: string;
  npub: string;
  reactions?: boolean;
  userStats?: UserStats;
}

export interface SearchUsersResponse {
  query: string;
  limit: number;
  sort: string;
  results: UserProfile[];
  fromCache: boolean;
}

// --- Adjusted types for fetchEsimData (OrderResponse) and fetchProducts (ProductPackage) ---

export interface Operator {
  operatorName: string;
  networkType: string;
}

export interface LocationNetwork {
  locationName: string;
  locationLogo: string;
  locationCode: string;
  operatorList: Operator[];
}

export interface ProductPackage {
  packageCode: string;
  slug: string;
  name: string;
  price: number;
  currencyCode: string;
  volume: number;
  smsStatus: number;
  dataType: number;
  unusedValidTime: number;
  duration: number;
  durationUnit: string;
  location: string;
  description: string;
  activeType: number;
  favorite: boolean;
  retailPrice: number;
  speed: string;
  ipExport: string;
  supportTopUpType: number;
  fupPolicy: string;
  locationNetworkList: LocationNetwork[];
}

export interface EsimPackage {
  packageName: string;
  packageCode: string;
  slug: string;
  duration: number;
  volume: number;
  locationCode: string;
  createTime: string;
}

export interface EsimListItem {
  esimTranNo: string;
  orderNo: string;
  imsi: string;
  iccid: string;
  smsStatus: number;
  msisdn: string;
  ac: string;
  qrCodeUrl: string;
  shortUrl: string;
  smdpStatus: string;
  eid: string;
  activeType: number;
  dataType: number;
  activateTime: string | null;
  expiredTime: string;
  installationTime: string | null;
  totalVolume: number;
  totalDuration: number;
  durationUnit: string;
  orderUsage: number;
  esimStatus: string;
  pin: string;
  puk: string;
  apn: string;
  ipExport: string;
  supportTopUpType: number;
  fupPolicy: string;
  packageList: EsimPackage[];
}

export interface EsimPager {
  pageSize: number;
  pageNum: number;
  total: number;
}

// Adjusted OrderResponse type to match the actual response for /esim/order
export interface EsimOrderResponse {
  success: boolean;
  errorCode: string | null;
  errorMsg: string | null;
  obj?: {
    orderNo: string;
  };
  [key: string]: any;
}

// The original OrderResponse for /order/query (esimList, pager) is still needed:
export interface OrderResponse {
  success: boolean;
  errorCode: string;
  errorMsg: string | null;
  obj?: {
    esimList: EsimListItem[];
    pager: EsimPager;
  };
  [key: string]: any;
}

export interface SearchResult {
  profileEvent: string;
  [key: string]: any;
}

const safeFetch = async <T = any>(url: string): Promise<Result<T, Error>> => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return err(new Error(`Fetch error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

const safePost = async <T = any>(url: string, body: any): Promise<Result<T, Error>> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return err(new Error(`Post error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

export interface FetchProductsResponse {
  errorCode: string | null;
  errorMsg: string | null;
  success: boolean;
  obj?: {
    packageList: ProductPackage[];
  };
}

export const fetchProducts = () => {
  return safeFetch<FetchProductsResponse>(`${BASE_URL}/esim/products`);
};

export interface QuoteResponse {
  request: string;
  p: ProductPackage & {
    ipExport: string;
    supportTopUpType: number;
    fupPolicy: string;
    locationNetworkList: LocationNetwork[];
  };
  sats: number;
}

export const fetchQuote = ({
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
  console.log(`${BASE_URL}/esim/quote?${params}`);
  return safeFetch<QuoteResponse>(`${BASE_URL}/esim/quote?${params}`);
};

// Adjusted to use EsimOrderResponse for /esim/order
export const fetchOrderData = ({
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
  return safeFetch<EsimOrderResponse>(`${BASE_URL}/esim/order?${params}`);
};

// /order/query still returns the original OrderResponse
export const fetchEsimData = ({ orderNo }: { orderNo: string }) =>
  safeFetch<OrderResponse>(`${BASE_URL}/order/query?orderNo=${orderNo}`);

export const searchUsers = ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return safeFetch<SearchUsersResponse>(`${BASE_URL}/nostr/search?${params}`);
};

export const fetchVpnInvoice = ({ duration }: { duration: string | number }) =>
  safeFetch<{ payment_hash: string; payment_request: string }>(
    `${BASE_URL}/vpn/invoice?duration=${duration}`
  );

export const fetchVpnCountries = () => safeFetch<any>(`${BASE_URL}/vpn/countries`);

export const activateVpn = ({
  paymentHash,
  location,
}: {
  paymentHash: string;
  location: string;
}) => {
  const params = new URLSearchParams({ paymentHash, location });
  return safeFetch<any>(`${BASE_URL}/vpn/activate?${params}`);
};

interface AuditMintResponse {
  id: number;
  url: string;
  info: GetInfoResponse;
  name: string;
  balance: number;
  sum_donations: number;
  updated_at: string;
  next_update: string;
  state: string;
  n_errors: number;
  n_mints: number;
  n_melts: number;
  swaps: {
    id: number;
    from_id: number;
    to_id: number;
    from_url: string;
    to_url: string;
    amount: number;
    fee: number;
    created_at: string;
    time_taken: number;
    state: string;
    error: string | null;
  }[];
}

export const auditMint = ({ mintUrl }: { mintUrl: string }) =>
  safeFetch<AuditMintResponse>(`${BASE_URL}/cashu/mint/audit?mintUrl=${mintUrl}`);

// The point of this object is to extract the structure of the state object
// This is so we don't send the state object with all its private data
// The reason I'm doing this is so I can help ensure the users state is not corrupted or invalid
// It's not a fullproof solution, but it will allow me to purge parts of the state if unused
// or restructure the state object if needed without being concerned about bugs.
// If any private data is leaked from this that would be considered a bug.
// Also we can at the same time check if the user is on the latest version.
export const getLatestVersion = ({
  storage,
}: {
  storage: {
    version: string;
    store: object;
  };
}) => safePost<{ version: string }>(`${BASE_URL}/app/latest-version`, storage);
