# Dependency and surface inventory — 2026-09-09

Baseline: `2ba87c865e8d3a2125be87f2425d007d7d1211a5`. The inventory maps 92 direct app runtime dependencies across 1278 runtime source files. Import counts exclude configuration, native linkage, generated code and bootstrap side effects; zero imports does **not** mean removable. Installed versions, rather than manifest ranges, informed this review.

This is a coverage index, not a claim that every dependency implementation has been exhaustively audited. See [implementation and remaining work](2026-09-09-implementation.md) and the [second interaction pass](2026-09-09-second-pass.md) for the source-reviewed paths and validation limits.

| Dependency | Installed | Requested | Importing files | Source / upstream |
| --- | --- | --- | ---: | --- |
| `@babel/runtime` | `7.29.7` | `^7.28.0` | 0 | [upstream](https://github.com/babel/babel) |
| `@bacons/apple-targets` | `4.0.7` | `^4.0.6` | 0 | [upstream](https://github.com/evanbacon/expo-apple-targets) |
| `@bacons/text-decoder` | `0.0.0` | `0.0.0` | 0 | [upstream](https://github.com/evanbacon/text-decoder-polyfill) |
| `@cashu/cashu-ts` | `5.0.0-rc.4` | `5.0.0-rc.4` | 41 | [upstream](https://github.com/cashubtc/cashu-ts) |
| `@cashu/coco-core` | `2.0.0` | `2.0.0` | 78 | [upstream](https://github.com/cashubtc/coco) |
| `@cashu/coco-expo-sqlite` | `2.0.0` | `2.0.0` | 1 | [upstream](https://github.com/cashubtc/coco) |
| `@cashu/coco-react` | `2.0.0` | `2.0.0` | 20 | [upstream](https://github.com/cashubtc/coco) |
| `@cashudevkit/react-native` | `0.17.3` | `github:crodas/cdk-nitro#v0.17.3` | 1 | `node_modules/@cashudevkit/react-native` |
| `@expo/ui` | `56.0.26` | `~56.0.18` | 4 | [upstream](https://github.com/expo/expo) |
| `@gandlaf21/bc-ur` | `1.1.12` | `^1.1.12` | 2 | [upstream](https://github.com/gandlafbtc/bc-ur) |
| `@gorhom/bottom-sheet` | `5.2.14` | `5.2.14` | 5 | [upstream](https://github.com/gorhom/react-native-bottom-sheet) |
| `@internet-privacy/marmot-ts` | `0.4.0` | `file:./vendor/marmot-ts` | 10 | [upstream](https://github.com/marmot-protocol/marmot-ts) |
| `@noble/hashes` | `2.3.0` | `2.3.0` | 18 | [upstream](https://github.com/paulmillr/noble-hashes) |
| `@nostr-dev-kit/ndk-mobile` | `0.2.2` | `^0.2.2` | 33 | `node_modules/@nostr-dev-kit/ndk-mobile` |
| `@react-native-async-storage/async-storage` | `2.2.0` | `2.2.0` | 19 | [upstream](https://github.com/react-native-async-storage/async-storage) |
| `@react-native-masked-view/masked-view` | `0.3.2` | `0.3.2` | 3 | [upstream](https://github.com/react-native-masked-view/masked-view) |
| `@react-native-menu/menu` | `2.0.0` | `^2.0.0` | 2 | [upstream](https://github.com/react-native-menu/menu) |
| `@scure/base` | `2.3.0` | `2.3.0` | 4 | [upstream](https://github.com/paulmillr/scure-base) |
| `@scure/bip32` | `2.3.0` | `2.3.0` | 1 | [upstream](https://github.com/paulmillr/scure-bip32) |
| `@scure/bip39` | `2.3.0` | `2.3.0` | 3 | [upstream](https://github.com/paulmillr/scure-bip39) |
| `@shopify/flash-list` | `2.3.2` | `2.3.2` | 8 | [upstream](https://github.com/Shopify/flash-list) |
| `@shopify/react-native-skia` | `2.6.2` | `2.6.2` | 3 | [upstream](https://github.com/Shopify/react-native-skia) |
| `@sovranbitcoin/coco-cashu-plugin-p2pk-import` | `0.2.0` | `^0.2.0` | 4 | [upstream](https://github.com/SovranBitcoin/coco-p2pk-plugin-helper) |
| `@sovranbitcoin/schemas` | `2.2.0` | `^2.2.0` | 49 | [upstream](https://github.com/SovranBitcoin/sovran-schemas) |
| `bitchat-module` | `0.1.0` | `file:./modules/bitchat-module` | 24 | `app/node_modules/bitchat-module` |
| `coco-cashu-plugin-npc` | `3.0.0` | `3.0.0` | 1 | [upstream](https://github.com/Egge21M/coco-cashu-plugin-npc) |
| `expo` | `56.0.20` | `^56.0.16` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-application` | `56.0.3` | `~56.0.3` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-asset` | `56.0.23` | `~56.0.17` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-blur` | `56.0.4` | `~56.0.3` | 11 | [upstream](https://github.com/expo/expo) |
| `expo-build-properties` | `56.0.26` | `~56.0.19` | 0 | [upstream](https://github.com/expo/expo) |
| `expo-camera` | `56.0.8` | `~56.0.8` | 3 | [upstream](https://github.com/expo/expo) |
| `expo-clipboard` | `56.0.4` | `~56.0.4` | 23 | [upstream](https://github.com/expo/expo) |
| `expo-constants` | `56.0.24` | `~56.0.18` | 3 | [upstream](https://github.com/expo/expo) |
| `expo-dev-client` | `56.0.25` | `~56.0.23` | 0 | [upstream](https://github.com/expo/expo) |
| `expo-file-system` | `56.0.10` | `~56.0.8` | 10 | [upstream](https://github.com/expo/expo) |
| `expo-font` | `56.0.7` | `~56.0.7` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-glass-effect` | `56.0.4` | `~56.0.4` | 5 | [upstream](https://github.com/expo/expo) |
| `expo-haptics` | `56.0.3` | `~56.0.3` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-image` | `56.0.12` | `~56.0.11` | 15 | [upstream](https://github.com/expo/expo) |
| `expo-image-manipulator` | `56.0.25` | `~56.0.19` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-image-picker` | `56.0.24` | `~56.0.18` | 4 | [upstream](https://github.com/expo/expo) |
| `expo-linear-gradient` | `56.0.4` | `~56.0.4` | 19 | [upstream](https://github.com/expo/expo) |
| `expo-linking` | `56.0.17` | `~56.0.14` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-location` | `56.0.24` | `~56.0.18` | 4 | [upstream](https://github.com/expo/expo) |
| `expo-maps` | `56.0.7` | `~56.0.7` | 4 | [upstream](https://github.com/expo/expo) |
| `expo-mesh-gradient` | `56.0.3` | `~56.0.3` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-network` | `56.0.5` | `~56.0.5` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-router` | `56.2.11` | `56.2.11` | 110 | [upstream](https://github.com/expo/expo) |
| `expo-screen-corner-radius` | `1.1.0` | `^1.1.0` | 0 | [upstream](https://github.com/damix00/expo-screen-corner-radius) |
| `expo-secure-store` | `56.0.4` | `~56.0.4` | 3 | [upstream](https://github.com/expo/expo) |
| `expo-sensors` | `56.0.6` | `~56.0.6` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-sharing` | `56.0.25` | `~56.0.18` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-splash-screen` | `56.0.14` | `~56.0.10` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-sqlite` | `56.0.5` | `~56.0.5` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-status-bar` | `56.0.4` | `~56.0.4` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-symbols` | `56.0.7` | `~56.0.6` | 2 | [upstream](https://github.com/expo/expo) |
| `expo-system-ui` | `56.0.5` | `~56.0.5` | 1 | [upstream](https://github.com/expo/expo) |
| `expo-video` | `56.1.4` | `~56.1.4` | 3 | [upstream](https://github.com/expo/expo) |
| `heroui-native` | `1.0.4` | `1.0.4` | 73 | [upstream](https://github.com/heroui-inc/heroui-native) |
| `liquid-glass-menu` | `0.1.0` | `file:./modules/liquid-glass-menu` | 3 | `app/node_modules/liquid-glass-menu` |
| `liquid-glass-text` | `0.1.0` | `file:./modules/liquid-glass-text` | 2 | `app/node_modules/liquid-glass-text` |
| `neverthrow` | `8.2.0` | `^8.2.0` | 39 | [upstream](https://github.com/supermacro/neverthrow) |
| `nostr` | `0.8.0-v2.0` | `workspace:*` | 20 | [upstream](https://github.com/SovranBitcoin/Sovran) |
| `nostr-tools` | `2.24.2` | `^2.10.4` | 36 | [upstream](https://github.com/nbd-wtf/nostr-tools) |
| `npubcash-sdk` | `0.3.2` | `0.3.2` | 2 | `node_modules/npubcash-sdk` |
| `react` | `19.2.3` | `19.2.3` | 479 | [upstream](https://github.com/facebook/react) |
| `react-dom` | `19.2.3` | `19.2.3` | 0 | [upstream](https://github.com/facebook/react) |
| `react-native` | `0.85.3` | `0.85.3` | 297 | [upstream](https://github.com/facebook/react-native) |
| `react-native-fast-squircle` | `1.1.5` | `1.1.5` | 1 | [upstream](https://github.com/fbeccaceci/react-native-fast-squircle) |
| `react-native-gesture-handler` | `2.32.0` | `^2.31.1` | 20 | [upstream](https://github.com/software-mansion/react-native-gesture-handler) |
| `react-native-image-colors` | `2.6.0` | `^2.6.0` | 1 | [upstream](https://github.com/osamaqarem/react-native-image-colors) |
| `react-native-keyboard-controller` | `1.21.12` | `1.21.12` | 5 | [upstream](https://github.com/kirillzyusko/react-native-keyboard-controller) |
| `react-native-nfc-manager` | `3.17.2` | `^3.14.12` | 4 | [upstream](https://github.com/whitedogg13/react-native-nfc-manager) |
| `react-native-nitro-modules` | `0.35.10` | `^0.35.10` | 0 | [upstream](https://github.com/mrousavy/nitro) |
| `react-native-pager-view` | `8.0.1` | `8.0.1` | 2 | [upstream](https://github.com/callstack/react-native-pager-view) |
| `react-native-qrcode-svg` | `6.3.21` | `^6.3.14` | 3 | [upstream](https://github.com/Expensify/react-native-qrcode-svg) |
| `react-native-quick-crypto` | `1.1.7` | `1.1.7` | 0 | [upstream](https://github.com/margelo/react-native-quick-crypto) |
| `react-native-reanimated` | `4.5.1` | `4.5.1` | 86 | [upstream](https://github.com/software-mansion/react-native-reanimated) |
| `react-native-restart` | `0.0.27` | `0.0.27` | 1 | [upstream](https://github.com/avishayil/react-native-restart) |
| `react-native-safe-area-context` | `5.9.0` | `^5.6.0` | 35 | [upstream](https://github.com/AppAndFlow/react-native-safe-area-context) |
| `react-native-screens` | `4.25.2` | `4.25.2` | 2 | [upstream](https://github.com/software-mansion/react-native-screens) |
| `react-native-svg` | `15.15.4` | `15.15.4` | 9 | [upstream](https://github.com/react-native-community/react-native-svg) |
| `react-native-web` | `0.21.2` | `~0.21.0` | 0 | `node_modules/react-native-web` |
| `react-native-webview` | `13.16.1` | `13.16.1` | 1 | [upstream](https://github.com/react-native-webview/react-native-webview) |
| `react-native-worklets` | `0.10.1` | `0.10.1` | 6 | [upstream](https://github.com/software-mansion/react-native-reanimated) |
| `supercluster` | `8.0.1` | `^8.0.1` | 2 | `node_modules/supercluster` |
| `tailwind-merge` | `3.6.0` | `^3.4.0` | 1 | [upstream](https://github.com/dcastil/tailwind-merge) |
| `uniwind` | `1.11.0` | `^1.3.2` | 3 | [upstream](https://github.com/uni-stack/uniwind) |
| `wallet` | `0.10.2` | `workspace:*` | 105 | [upstream](https://github.com/SovranBitcoin/Sovran) |
| `zod` | `4.4.3` | `^4.3.6` | 113 | [upstream](https://github.com/colinhacks/zod) |
| `zustand` | `5.0.15` | `^5.0.8` | 64 | [upstream](https://github.com/pmndrs/zustand) |

## Feature coverage index

Source file counts include tests under each feature. They describe surface size, not test coverage or performance cost.

| Feature | Source files |
| --- | ---: |
| `ai` | 14 |
| `bitchat` | 15 |
| `camera` | 8 |
| `composer` | 11 |
| `contacts` | 11 |
| `feed` | 109 |
| `map` | 6 |
| `mint` | 42 |
| `nearPay` | 24 |
| `nostrSigner` | 49 |
| `onboarding` | 9 |
| `payments` | 14 |
| `receive` | 24 |
| `send` | 28 |
| `settings` | 34 |
| `theme` | 8 |
| `transactions` | 35 |
| `user` | 8 |
| `wallet` | 30 |
| `whitenoise` | 21 |

## List instances

These are AST-discovered JSX sites, not a grep count of imports. File/line references are an inspection snapshot. A prop absent here can be supplied by a wrapper or spread; absence alone is not a defect.

| Source | Component | Explicit list controls |
| --- | --- | --- |
| `features/ai/screens/AiChatScreen.tsx:379` | `FlashList` | `keyExtractor`, `maintainVisibleContentPosition` |
| `features/bitchat/screens/NetworkSheet.tsx:158` | `List` | `keyExtractor` |
| `features/contacts/components/SearchPostsList.tsx:166` | `List` | `keyExtractor` |
| `features/contacts/screens/ContactsScreen.tsx:418` | `List` | `onEndReached`, `keyExtractor` |
| `features/contacts/screens/ContactsScreen.tsx:440` | `List` | `keyExtractor` |
| `features/feed/components/HomeFeed.tsx:653` | `List` | `keyExtractor`, `getItemType`, `drawDistance`, `onEndReached` |
| `features/feed/components/ThreadView.tsx:629` | `FlashList` | `keyExtractor`, `getItemType`, `drawDistance`, `onEndReached`, `initialScrollIndex` |
| `features/feed/components/UserFeed.tsx:698` | `List` | Wrapper/defaults or none at this site |
| `features/feed/components/UserFeed.tsx:709` | `List` | `keyExtractor`, `getItemType`, `drawDistance`, `onEndReached` |
| `features/feed/components/nostr/StoriesCarousel.tsx:280` | `Animated.FlatList` | `keyExtractor`, `horizontal`, `onViewableItemsChanged`, `getItemLayout`, `initialScrollIndex` |
| `features/feed/screens/NotificationFollowersScreen.tsx:432` | `List` | `keyExtractor`, `onEndReached`, `onViewableItemsChanged` |
| `features/feed/screens/NotificationsScreen.tsx:852` | `List` | `keyExtractor`, `getItemType`, `onEndReached`, `onViewableItemsChanged` |
| `features/mint/components/mintChanges/MintChangesList.tsx:123` | `List` | `keyExtractor`, `onViewableItemsChanged` |
| `features/mint/screens/MintAddScreen.tsx:778` | `List` | `keyExtractor`, `getItemType`, `drawDistance`, `maintainVisibleContentPosition` |
| `features/mint/screens/MintChangesScreen.tsx:156` | `List` | `keyExtractor` |
| `features/mint/screens/MintListScreen.tsx:274` | `List` | `keyExtractor`, `drawDistance`, `maintainVisibleContentPosition` |
| `features/mint/screens/MintReviewsScreen.tsx:470` | `List` | `keyExtractor` |
| `features/nearPay/screens/NearPayPeerListScreen.tsx:226` | `List` | `keyExtractor` |
| `features/nostrSigner/screens/SignerActivityScreen.tsx:240` | `List` | `keyExtractor`, `drawDistance` |
| `features/onboarding/components/OnboardingInnerCarousel.tsx:115` | `AnimatedFlatList` | `horizontal`, `initialScrollIndex`, `getItemLayout`, `onViewableItemsChanged`, `onEndReached` |
| `features/theme/screens/BackgroundScreen.tsx:201` | `List` | `keyExtractor`, `numColumns` |
| `features/theme/screens/GalleryScreen.tsx:96` | `FlatList` | `horizontal`, `keyExtractor` |
| `features/transactions/components/Transactions.tsx:789` | `FlashList` | `keyExtractor`, `drawDistance`, `maintainVisibleContentPosition`, `onEndReached`, `onViewableItemsChanged` |
| `shared/lib/popup/popups/emojiPicker.tsx:283` | `List` | `keyExtractor`, `drawDistance` |
| `shared/lib/popup/popups/sendMemoSheet.tsx:379` | `List` | `keyExtractor` |
| `shared/ui/composed/List.tsx:60` | `FlashList` | `drawDistance` |
| `shared/ui/composed/PillTabs.tsx:103` | `FlatList` | `keyExtractor`, `horizontal` |
| `shared/ui/composed/SectionAnchorList.tsx:504` | `FlashList` | `keyExtractor`, `getItemType`, `drawDistance`, `onViewableItemsChanged` |
| `shared/ui/composed/chat/ChatScreen.tsx:340` | `FlashList` | `keyExtractor`, `maintainVisibleContentPosition` |
| `shared/ui/composed/search/SearchResultRows.tsx:174` | `List` | `keyExtractor`, `getItemType` |
| `shared/ui/composed/search/SearchScopeTabs.tsx:27` | `FlatList` | `horizontal`, `keyExtractor` |
