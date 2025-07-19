interface EsimPackage {
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
  retailPrice: number;
  speed: string;
}

export interface EsimOrder {
  request: string;
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
  activateTime: string | null; // Can be null as seen in the data
  expiredTime: string;
  installationTime: string | null; // Can be null as seen in the data
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
  packageList?: EsimInnerPackage[];
}

interface EsimInnerPackage {
  packageName: string;
  packageCode: string;
  slug: string;
  duration: number;
  volume: number;
  locationCode: string;
  createTime: string;
}

export interface Esim {
  package: EsimPackage;
  sats: number;
  request: string;
  type: string;
  order?: EsimOrder; // Made optional since some entries don't have an order
}

export interface EsimState {
  esims: Esim[];
}
