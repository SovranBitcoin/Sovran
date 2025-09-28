# Project Structure with Descriptions and TODOs

## Root Directory

```
.
├── .gitignore
├── LICENSE
├── README.md
```

## App Directory Structure

### Main App Navigation

```
app/
├── (drawer)/
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Tab navigation layout (wallet, lifestyle, payments)
│   │   ├── index.tsx           # Main wallet screen
│   │   ├── lifestyle.tsx       # Lifestyle/social features
│   │   └── payments.tsx        # Payment-related features
│   └── _layout.tsx             # Drawer navigation layout
```

### Core Pages

```
app/
├── _layout.tsx                 # Entry point with all providers
├── settings/
│   ├── about.tsx               # App information and version details
│   ├── design.tsx              # **TODO: Internal use only - component showcase**
│   ├── passcode.tsx            # Passcode setup and management
│   ├── profile.tsx             # Private profile information
│   ├── proofs.tsx              # **TODO: DELETE - unused**
│   ├── restoreCounter.tsx      # **TODO: DELETE - unused**
│   ├── store.tsx               # **TODO: DELETE - unused**
│   ├── terms.tsx               # **TODO: Move to component, not settings**
│   └── websocketConnections.tsx # **TODO: DELETE - unused**
```

### Payment & Transaction Pages

```
app/
├── ecashReceiveConfirmation.tsx    # Ecash receive flow confirmation
├── ecashSendConfirmation.tsx       # Ecash send flow confirmation
├── lightningReceiveConfirmation.tsx # Lightning receive confirmation
├── lightningSendConfirmation.tsx   # Lightning send confirmation
├── transaction.tsx                 # Individual transaction details
├── transactions.tsx                # Transaction list with filtering
├── currency.tsx                    # Amount selector/input page
└── receive.tsx                     # **TODO: DELETE - likely obsolete**
```

### User & Social Features

```
app/
├── Profile.tsx                 # **TODO: Rename/move - drawer profile page**
├── profileShare.tsx            # Profile sharing with Nostr QR code
├── contacts.tsx                # Nostr user search functionality
├── userMessages.tsx            # DM view with transaction history
├── feed.tsx                    # User's social feed page
└── camera.tsx                  # Camera functionality page
```

### Configuration & Settings

```
app/
├── settings.tsx                # **TODO: Rename to index.tsx, move to folder**
├── languageSettings.tsx        # **TODO: Move to settings/ folder**
├── themeSettings.tsx           # **TODO: Move to settings/ folder**
├── notifications.tsx           # **TODO: DELETE - unused**
└── global.ts                   # **TODO: Move to better location**
```

### Specialized Page Components

```
app/
├── MessagePage/                # Message display components
│   ├── CashuTokenComponent.tsx # Cashu token rendering
│   ├── Footer.tsx              # Message footer
│   ├── Header.tsx              # Message header
│   ├── MessageComponent.tsx    # Main message display
│   ├── TimeLine.tsx            # Message timeline
│   ├── TransactionComponent.tsx # Transaction in message
│   └── index.tsx               # Main message page
├── ProfilePage/                # Profile page components
│   ├── ActionItems.tsx         # Profile actions
│   ├── ExternalLink.tsx        # External link handling
│   ├── ImageContainer.tsx      # Image display container
│   ├── TextContent.tsx         # Text content display
│   ├── VideoPlayer.tsx         # Video playback
│   ├── helper.tsx              # Profile helper functions
│   └── post.tsx                # Profile post component
└── onboard/                    # Onboarding flow
    ├── BottomButtons.tsx       # Navigation buttons
    ├── MintItem.tsx            # Mint selection item
    ├── OnboardLayout.tsx       # Layout wrapper
    ├── animate.tsx             # Animation components
    ├── components/
    │   ├── CurrencyIcon.tsx    # Currency display
    │   ├── TouchableOpacityProgress.tsx # Progress button
    │   └── fetchAccountData.tsx # Account data fetching
    ├── displayMnemonic.tsx     # Mnemonic display
    ├── ecash.tsx               # Ecash setup
    ├── go.tsx                  # Completion step
    ├── helper.tsx              # Onboarding helpers
    ├── mnemonic.tsx            # Mnemonic generation
    ├── new.tsx                 # New account creation
    ├── nostr.tsx               # Nostr setup
    └── restoreChoice.tsx       # Account restoration
```

## Assets Structure

```
assets/
├── fonts/
│   ├── Lexend/                 # Primary font family
│   └── Overpass/               # Secondary font family
├── icons/
│   ├── flag.tsx                # **TODO: Replace with library/emojis**
│   └── index.tsx               # **TODO: Migrate to Metro icons gradually**
└── images/                     # **TODO: Restructure - very messy**
    ├── backgrounds/            # Background images
    ├── giftcards/              # Gift card brand images
    ├── cashews.png
    ├── sovran_black.png
    ├── sovran_transparent.png
    └── splash.png
```

## Components Structure

### Common Components

```
components/
├── common/                     # Reusable UI components
│   ├── AmountFormatter.tsx     # Currency amount display
│   ├── Avatar.tsx              # User avatar component
│   ├── Button.tsx              # Standard button component
│   ├── ButtonHandler.tsx       # Button interaction logic
│   ├── Card.tsx                # Card container component
│   ├── GradientSkeleton.tsx    # Loading skeleton [TODO: use library or npm module]
│   ├── Haptics.tsx             # Haptic feedback
│   ├── Image.tsx               # Image component wrapper
│   ├── QRCode.tsx              # QR code generation
│   ├── SearchableList.tsx      # Searchable list component
│   ├── Section.tsx             # Section container
│   ├── Spinner.tsx             # Loading spinner
│   ├── SpriteView.tsx          # Sprite animation
│   ├── Tabs.tsx                # Tab component
│   ├── Text.tsx                # Text component wrapper
│   ├── TextInput.tsx           # Text input component
│   ├── TextInputBase.tsx       # Base text input [TODO: unify TextInput and TextInputBase]
│   ├── TouchableOpacity.tsx    # Touchable wrapper
│   ├── Transaction/            # Transaction-specific components [TODO: what if we make a common/ui and common/block where ui is for random elements that are common like Text, but blocks are for combinations of UI elements like owuld be the case for these Transaction components]
│   │   ├── TransactionDebugCode.tsx
│   │   ├── TransactionHeader.tsx
│   │   └── TransactionMintRefresh.tsx
│   ├── TransactionIcon.tsx     # Transaction type icons [todo: move to wherever Transactions go after blocks folder is made]
│   ├── View.tsx                # View component wrapper
│   └── useNfc.tsx              # NFC functionality hook [TODO: this is in the wrong place]
```

### Layout Components

```
components/
├── layout/                     # Layout and complex UI components
│   ├── Account.tsx             # Account display component
│   ├── AccountPagerView.tsx    # Account pager/swiper
│   ├── Camera.tsx              # Camera interface
│   ├── Container.tsx           # Main container wrapper
│   ├── CurrencySelector.tsx    # Currency selection UI
│   ├── CustomKeyboard.tsx      # Custom numeric keyboard
│   ├── MintBalanceDisplay.tsx  # Mint balance display
│   ├── Modal.tsx               # Modal wrapper [TODO: might be a common component or maybe in a seperate place for layout related components]
│   ├── NonGestureView.tsx      # Non-interactive view [TODO: might be a common component]
│   ├── PaymentInfo.tsx         # Payment information display
│   ├── PrimaryBalance.tsx      # Main balance display
│   ├── Transaction.tsx         # Transaction list item
│   ├── Transactions.tsx        # Transaction list container
│   ├── TransferRow.tsx         # Transfer list item
│   ├── VStack.tsx              # Vertical stack layout [TODO: move to common wheever layout components go]
│   ├── WalletHeader.tsx        # Wallet header component
│   └── sheets/                 # Bottom sheet modals
│       ├── registerSheets.tsx  # Sheet registration
│       ├── wrapper.tsx         # Sheet wrapper
│       ├── example/            # Example sheet implementation
│       ├── email/              # Email input sheet
│       ├── emoji-picker/       # Emoji selection sheet
│       ├── lightning-mpp/      # Lightning multi-part payment
│       ├── mint-*/            # Various mint-related sheets
│       ├── mints/             # Mint management sheets
│       ├── popup/             # Generic popup sheet
│       └── transaction-message/ # Transaction messaging
```

### Specialized Components

```
components/
├── ndk.ts                      # Nostr Development Kit integration
├── passcode/                   # Passcode/security components
│   ├── NumericKeyboard.tsx     # Numeric input keyboard
│   ├── PasscodeGate.tsx        # Passcode verification gate
│   └── PasscodeScreen.tsx      # Passcode entry screen
└── providers/                  # React context providers
    ├── PricelistProvider.tsx   # Price data provider
    ├── TransactionsProvider.tsx # Transaction data provider
    └── WalletsProviders.tsx    # Wallet state provider
```

## Helper & Utilities Structure

```
helper/
├── Essential.ts                # Core utility functions
├── apiClient.ts                # API communication layer
├── backgroundImages.ts         # Background image utilities
├── cashuClient.ts              # Cashu protocol client
├── colors.tsx                  # Color theme definitions
├── constants.ts                # App-wide constants
├── currency.ts                 # Currency conversion utilities
├── navigation/                 # Navigation utilities
│   ├── hooks/                  # Navigation hooks
│   ├── screens.tsx             # Screen definitions [todo: I feel like this should be near some _layout page or included in it. can I do _layout.screens.tsx?]
│   └── types/                  # Navigation type definitions
├── nostr/                      # Nostr protocol utilities
├── nostrClient.ts              # Nostr client implementation
├── payment-handler/            # Payment processing logic
├── popup/                      # Popup management utilities
├── redux/                      # State management
│   ├── cashu/                  # Cashu state management
│   ├── nostr/                  # Nostr state management
│   ├── pricelist/              # Price data state
│   ├── settings/               # App settings state
│   └── store/                  # Redux store configuration
├── secureStorage.ts            # Secure storage utilities
├── strings.ts                  # String constants and i18n
├── third-party/                # Third-party integrations
│   ├── cashu-address-sdk-rn/   # Cashu address SDK
│   ├── emoji.ts                # Emoji utilities
│   └── lnurl.ts                # Lightning URL utilities
├── time.ts                     # Time/date utilities
├── toResult.ts                 # Result type utilities
├── typedUpdate.ts              # Type-safe update utilities
└── version.ts                  # Version management
```

## Priority TODOs by Category

### 🗑️ Deletion Candidates

- `app/settings/proofs.tsx`
- `app/settings/restoreCounter.tsx`
- `app/settings/store.tsx`
- `app/settings/websocketConnections.tsx`
- `app/notifications.tsx`
- `app/receive.tsx`

### 📁 File Organization

- Move `app/languageSettings.tsx` → `app/settings/language.tsx`
- Move `app/themeSettings.tsx` → `app/settings/theme.tsx`
- Move `app/settings.tsx` → `app/settings/index.tsx`
- Move `app/global.ts` to better location (possibly `helper/` or `constants/`)
- Rename `app/Profile.tsx` to be more descriptive

### 🎨 Asset Cleanup

- Restructure `assets/images/` directory
- Replace `assets/icons/flag.tsx` with emoji or icon library
- Gradually migrate custom icons to Metro icons
- Organize background images more systematically

### 🧩 Component Improvements

- Convert `app/settings/terms.tsx` to reusable component
- Consider splitting large page components into smaller pieces
- Standardize component naming conventions

### 🔧 Technical Debt

- Review and clean up unused dependencies
- Standardize file naming conventions across the project
- Consider consolidating similar functionality across different sheets
