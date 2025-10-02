export type NavigationParams = {
  camera: {
    unit: string;
  };
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
  giftcard: {
    slug: string;
    image: string;
  };
  displayMnemonic: {
    mnemonic: string;
  };
  animate: {
    mnemonic: string;
    type: string;
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
    to?: string;
    amount?: number;
    token?: string;
    request?: string;
    transaction?: string;
  };
  transactions: {
    account: { unit: string };
    tab: 'All' | 'Incoming' | 'Outgoing';
  };
  wallets: {
    accounts: string;
  };
  send: {
    unit: string;
    type: string;
  };
  feed: {
    pubkey: string;
  };
  userMessages: {
    pubkey: string;
  };
  contacts: {
    unit: string;
  };
};
