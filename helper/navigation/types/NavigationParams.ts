export type NavigationParams = {
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
  vpnShare: {
    vpnCode: string;
    location: string;
    config: string;
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
  esimCountrySelection: {
    countries: string[];
    packageList: any; // TODO: Add more specific type when available
    type: 'vpn' | 'esim';
  };

  charts: {};
  chart: {
    type: string;
  };

  // Add other endpoints here
  // exampleEndpoint: { param1: string; param2: number };
};

export type NavigationEndpoints = keyof NavigationParams;
