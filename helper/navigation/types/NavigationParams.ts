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

  esim: {
    request: string;
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
    request: string;
    type: string;
    volume: number;
    duration: number;
    speed: string;
    location: string;
    iccid: string;
    topup: boolean;
    topupAmount: number;
    price: number;
  };
  esimCountrySelection: {
    countries: string[];
    packageList: any; // TODO: Add more specific type when available
    type: 'vpn' | 'esim';
  };

  // Add other endpoints here
  // exampleEndpoint: { param1: string; param2: number };
};

export type NavigationEndpoints = keyof NavigationParams;
