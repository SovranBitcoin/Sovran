/**
 * Canonical page registry. Every screenshot step's `name` must be exactly the
 * canonical name of the app page visible at capture time — the viewer's Pages
 * gallery groups captures by this name across scenarios and runs, and repeats
 * within a scenario are told apart by the artifact occurrence counter, so the
 * name itself never encodes a situation ("wallet-start") or an index
 * ("slide-1"). A toast or sheet OVER a page still counts as that page.
 *
 * Names must never end in `-<digits>`: the viewer parses named artifacts with
 * a trailing `-NNN` sequence (`<name>-017.png`), so a digit-suffixed page name
 * would be ambiguous to strip.
 */
export const CANONICAL_PAGES = [
  // launch + onboarding
  'splash', // boot splash before the Terms gate on a fresh install
  'terms', // Terms & Conditions gate
  'onboarding-carousel', // the four intro slides (occurrences 1-4)
  'welcome', // "Welcome to Sovran" + Get Started reveal
  // shell
  'wallet', // wallet home (WalletScreen)
  'drawer', // profile drawer (drawer-profile-name)
  // receive flow
  'receive', // receive method hub sheet (receive-method-*)
  'receive-qr', // standing receive rails QR display (ReceiveScreen: Unified/Lightning/Onchain/Cashu)
  'receive-amount', // amount entry in the receive flow
  'lightning-receive', // lightning invoice / mint-quote QR screen (incl. tx re-entry)
  'receive-token', // ecash token preview/redeem screen
  // send flow
  'send', // send method hub sheet
  'send-amount', // amount entry in the send flow
  'send-token', // created ecash token screen (incl. tx re-entry)
  'lightning-send', // bolt11 melt preview/confirmation
  // shared + recovery
  'mint-select', // mint selector list (receive and send flows)
  'mint-add', // add-mints screen (search or enter URL, MintAddScreen)
  'mint-info', // mint info / trust decision screen (MintInfoScreen)
  'mint-reviews', // mint KYM reviews list (MintReviewsScreen)
  'profile', // nostr user profile (UserProfileScreen)
  'dm-chat', // 1:1 DM conversation (UserMessagesScreen, dm-chat-probe)
  'search', // header search overlay with results (SearchOverlay)
  'settings', // settings root screen ((settings-flow), SettingsScreen)
  'feed', // home feed tab (FeedScreen: For You / Following)
  'contacts', // contacts tab (ContactsScreen)
  'notifications', // notifications tab (NotificationsScreen)
  'ai', // AI chat tab (AiChatScreen)
  'signer-hub', // Remote Login / NIP-46 signer hub
  'theme-preview', // per-unit wallpaper preview cards ((theme-flow)/preview)
  'gallery', // wallpaper album gallery ((theme-flow)/gallery)
  'transactions', // full transactions list ((transactions-flow)/transactions)
  'balance-split', // per-mint distribution sliders (MintDistributionScreen)
  'rebalance-plan', // rebalance transfer plan + run progress (MintRebalancePlanScreen)
  'swap', // swap-group detail screen (SwapTransactionScreen)
  'restore-gate', // recovery gate with slide-to-confirm
  'recovery-complete', // recovery success state with Continue
] as const;

export const CANONICAL_PAGE_SET: ReadonlySet<string> = new Set(CANONICAL_PAGES);

export const isCanonicalPage = (name: string): boolean => CANONICAL_PAGE_SET.has(name);
