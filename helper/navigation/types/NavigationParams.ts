import { ProductPackage, QuoteResponse } from 'helper/apiClient';

export type NavigationParams = {
  currency: {
    amount: number;
    unit: string;
    to: string;
    paymentRequest: string;
    profile: {
      pubkey: string;
      npub: string;
      picture: string;
      image: string;
    };
    lud16: string;
    allowedUnits: string[];
    mints?: string;
  };
  bitrefill: {
    product: {
      _id: string;
    };
    amount: number;
    email: string;
  };
  giftcard: {
    slug: string;
    image: string;
  };
  esim: {
    request: string;
  };
  displayMnemonic: {
    mnemonic: string;
  };
  animate: {
    mnemonic: string;
    type: string;
  };
  feed: {
    pubkey: string;
  };
  mnemonic: {
    type: string;
    mnemonic: string | null;
  };
  ecashReceiveConfirmation: {
    token: string;
  };
  lightningSendConfirmation: {
    pr: string;
    unit: string;
    meltQuote?: string;
    pubkey?: string;
    redirect?: string;
    amount?: number;
  };
  ecashSendConfirmation: {
    unit: string;
    amount: number;
    token: string;
    paymentRequest?: string;
  };
  userMessages: {
    pubkey: string;
  };
  lightningReceiveConfirmation: {
    request: string;
    unit: string;
    amount: number;
    transaction: string;
  };
  modal: {
    id: string;
    transactionType: string;
  };
  post: {
    id: string;
  };
  profileShare: {
    npub: string;
  };
  receive: {
    unit: string;
    type: string;
  };
  transactions: {
    account: { unit: string };
    tab: 'All' | 'Incoming' | 'Outgoing';
  };
  vpnShare: {
    vpnCode: string;
    location: string;
    config: string[];
    hash: string;
  };
  wallets: {
    accounts: string;
  };
  camera: {
    unit: string;
    accountIndex: number;
  };

  send: {
    unit: string;
    type: string;
  };
  contacts: {
    unit: string;
  };
  esimShare: {
    esimCode: string;
    esimLink: string;
    location: string;
  };
  languageSettings: {
    countries: string[];
  };
  esimCheckout: {
    quote: QuoteResponse;
    package: ProductPackage;
    esimParams: {
      iccid: string;
      type: 'BASE' | 'TOPUP';
      topup: boolean;
      topupAmount: number;
    };
  };
  esimCountrySelection: {
    countries: string[];
    packageList?: ProductPackage[];
    type: 'vpn' | 'esim';
    esimType?: 'BASE' | 'TOPUP'; // Preserve the original esim type
    iccid?: string; // Also preserve iccid for when we navigate back
  };
  esimsDataPlan: {
    country?: string;
    packageList?: ProductPackage[];
    countries?: string[];
    iccid?: string;
    type: 'BASE' | 'TOPUP';
  };

  // Add other endpoints here
  // exampleEndpoint: { param1: string; param2: number };
};

export type NavigationEndpoints = keyof NavigationParams;
