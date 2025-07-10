export interface EsimOrder {
  orderNo?: string;
  esimStatus?: string;
  smdpStatus?: string;
  ac?: string;
  qrCodeUrl?: string;
  shortUrl?: string;
  [key: string]: any;
}

export interface EsimPackage {
  packageCode: string | number;
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
  favorite: boolean;
  retailPrice: number;
  speed: string;
}

export interface Esim {
  package: EsimPackage;
  sats: number;
  request: string;
  type?: string;
  iccid?: string;
  order?: EsimOrder;
}

export interface EsimState {
  esims: Esim[];
}
