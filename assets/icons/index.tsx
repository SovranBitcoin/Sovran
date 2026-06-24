import React from 'react';
import Svg, { Circle, Defs, Path, Rect, Stop, LinearGradient } from 'react-native-svg';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { Monicon } from '@monicon/native';

import type { StyleProp, ViewStyle } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';

type IconProps = {
  name: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
};

function Icon({ name, color, size = 24, style = {}, className }: IconProps) {
  const foreground = useThemeColor('foreground');

  return (
    <View style={style} className={className}>
      <Monicon name={name} size={size} color={color || foreground} />
    </View>
  );
}

export default Icon;

// Common icon names for design showcase
export const icons: string[] = [
  // Your existing icons array...
  // Currency flag icons used by MintCurrencyTabs via a template literal —
  // the monicon scanner can't follow the dynamic name, so list them here
  // so regeneration of .monicon/icons.js keeps them.
  'circle-flags:us',
  'circle-flags:eu',
  'circle-flags:gb',
  // Post action menus (repost / ignore) — referenced from actionMenuPopup
  // string literals the scanner can't follow.
  'mdi:format-quote-close',
  'mdi:eye-off-outline',
  'mdi:account-cancel-outline',
  'mdi:account-multiple',
  // Empty-state showcase variants — passed dynamically through EmptyState.
  'mdi:receipt-text-outline',
  'mdi:bluetooth-off',
  'hugeicons:blockchain-01',
  'fluent:apps-16-filled',
  'ri:openai-fill', // Using robot as OpenAI icon
  'ri:anthropic-fill',
  'ri:twitter-x-fill',
  'mdi:brain',
  'mdi:help-circle',
  'mdi:check-circle',
  'lucide:arrow-down-left',
  'fluent:filter-16-filled',
  'lucide:activity',
  'fluent:chevron-down-12-filled',
  'lucide:arrow-up-right',
  'fluent:add-24-filled',
  'fluent:arrow-upload-16-filled',
  'fluent:arrow-download-16-filled',
  'fluent:arrow-swap-16-filled',
  'iconamoon:send-fill',
  'ri:share-fill',
  'lets-icons:copy',
  'lucide:pencil-line',
  'lucide:delete',
  'simple-line-icons:check',
  'lucide:nfc',
  'fluent:checkmark-16-filled',
  'fluent:checkmark-circle-16-filled',
  'fluent:list-16-filled',
  'fluent:clock-16-filled',
  'fluent:dismiss-circle-16-filled',
  'material-symbols:close-rounded',
  'nonicons:error-16',
  'mdi:cancel',
  'ph:user-bold',
  'la:user-plus',
  'majesticons:eye',
  'majesticons:eye-off',
  'material-symbols:currency-bitcoin',
  'material-symbols-light:currency-bitcoin',
  'fluent:wallet-20-filled',
  'fluent:wallet-20-regular',
  'majesticons:coins',
  'ph:coins',
  'material-symbols:arrow-back-rounded',
  'material-symbols:verified-rounded',
  'material-symbols:verified',
  'ph:contactless-payment-fill',
  'mdi:decimal',
  'fluent:emoji-24-filled',
  'mdi:lightbulb-on-outline',
  'mdi:lightbulb-on',
  'proicons:photo',
  'majesticons:search-line',
  'solar:key-bold',
  'garden:arrow-retweet-fill-16',
  'iconamoon:comment-fill',
  'garden:heart-fill-16',
  'iconamoon:heart-fill',
  'hugeicons:new-twitter',
  'mdi:at',
  'mingcute:lightning-fill',
  'mingcute:play-fill',
  'material-symbols:report-rounded',
  'material-symbols:settings-rounded',
  'mdi:robot',
  'feather:wifi',
  'clarity:internet-of-things-solid',
  'bx:dots-vertical-rounded',
  'tabler:dots',
  'fluent:clock-12-filled',
  'stash:qr-code',
  'ic:round-star',
  'humbleicons:url',
  'lucide:square-pen',
  'mdi:menu',
  'mingcute:home-4-fill',
  'mingcute:home-4-line',
  'mdi:bell',
  'mdi:bell-off-outline',
  'mdi:bell-outline',

  // Explore page icons
  'mdi:chevron-left',
  'mdi:chevron-right',
  'mdi:map-marker',
  'mdi:account-group',
  'mdi:arrow-right',
  'mdi:trending-up',
  'mdi:airplane',

  // Map page icons
  'mdi:bitcoin',
  'mdi:crosshairs-gps',
  'mdi:phone',
  'mdi:web',
  'mdi:email',
  'mdi:instagram',
  'mdi:close-circle',
  'mdi:close',
  'mdi:lock-open-variant-outline',
  'mdi:lan-disconnect',
  'mdi:store',
  'mdi:cash-multiple',
  'mdi:camera',
  'mdi:tree',
  'mdi:currency-usd',
  'mdi:palette',
  'mdi:alert-circle',
  'mdi:chevron-down',
  'mdi:minus',
  'mdi:plus',

  // Keyring page icons
  'mdi:key-plus',
  'mdi:key-arrow-right',
  'mdi:trash-can-outline',
  'mdi:chevron-up',
  'mdi:key-variant',

  // Lightning Address card icons
  'mdi:arrow-down',
  'mdi:share-variant',
  'mdi:qrcode',

  // Claim username modal icons
  'mdi:check',

  // Pending Ecash icons
  'mdi:clock-outline',
  'mdi:clock-alert-outline',
  'mdi:broom',
  'mdi:check-circle-outline',
  'fluent:wallet-24-filled',

  // Video feed icons (iconamoon to match comment/heart engagement icons)
  'mdi:fullscreen',

  // Icons discovered in codebase but previously missing from array
  'feather:wifi-off',
  'fluent:circle-16-filled',
  'fluent:split-vertical-24-filled',
  'lucide:clipboard-paste',
  'lucide:link',
  'material-symbols:arrow-downward',
  'material-symbols:keyboard-arrow-down-rounded',
  'material-symbols:search-rounded',
  'mdi:account-circle',
  'mdi:alert-circle-outline',
  'mdi:arrow-collapse-down',
  'mdi:arrow-collapse-up',
  'mdi:arrow-up',
  'mdi:bank-off-outline',
  'mdi:cash-refund',
  'mdi:check-all',
  'mdi:check-decagram',
  'mdi:equal',
  'mdi:information',
  'mdi:key-chain',
  'mdi:lightning-bolt',
  'mdi:magnify',
  'mdi:map-marker-radius',
  'mdi:message-outline',
  'mdi:message-reply',
  'mdi:message-text',
  'mdi:microphone',
  'mdi:open-in-new',
  'mdi:play',
  'mdi:qrcode-scan',
  'mdi:refresh',
  'mdi:restore',
  'mdi:send',
  'mdi:broadcast',
  'mdi:target',
  'mdi:wifi',
  'mdi:wrench',
  'mingcute:bank-fill',
  'mingcute:user-3-fill',
  'mdi:shield',
  'mdi:shield-check',
  'mdi:shield-refresh',
  'mdi:shield-remove',
  'mdi:shuffle-variant',
  'mdi:skip-next',
  'mdi:swap-horizontal',
  'mdi:ticket-percent',
  'mingcute:search-3-fill',
  'mingcute:search-3-line',
  'ri:arrow-left-line',
  'ri:close-circle-line',
  'ri:error-warning-line',
  'ri:loader-line',
  'ri:send-plane-2-fill',
  'solar:wallet-bold',
  // BitChat / Group Chats
  'mdi:bluetooth',
  'mdi:map',
  'mdi:compass',
  'mdi:earth',
  'mdi:pound',
  'mdi:home',

  // Wallpaper screens
  'mdi:download',
  'mdi:cloud-download-outline',

  // Drawer and bottom tab bar route icons — selected/unselected pairs
  'mdi:account-group-outline',
  'mdi:robot-outline',

  // Nostr posting — composer, polls, relays, share, media states
  'mdi:pencil',
  'mdi:image-plus',
  'mdi:poll',
  'mdi:minus-circle-outline',
  'mdi:checkbox-marked',
  'mdi:radiobox-marked',
  'mdi:checkbox-blank-outline',
  'mdi:radiobox-blank',
  'mdi:server-network-off',
  'mdi:wifi-off',
  'mdi:account-multiple-plus-outline',
  'mdi:share-variant-outline',
  'mdi:link-variant',
  'mdi:image-broken-variant',
  'mdi:arrow-expand',
];

export function BitcoinMaskIcon() {
  const [surfaceSecondary, surfaceTertiary, surface] = useThemeColor([
    'surface-secondary',
    'surface-tertiary',
    'surface',
  ] as const);

  return (
    <Svg width="150" height="150" viewBox="0 0 158 158" fill="none">
      <Defs>
        <LinearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop stopOpacity={0} offset="0%" stopColor={surfaceSecondary} />
          <Stop stopOpacity={1} offset="100%" stopColor={surfaceTertiary} />
        </LinearGradient>
      </Defs>
      <Path
        d="M154.864 97.6365C144.364 139.753 101.707 165.385 59.5855 154.882C17.4811 144.382 -8.15047 101.722 2.35473 59.6079C12.8501 17.4864 55.5072 -8.14769 97.6165 2.35261C139.736 12.8529 165.365 55.5174 154.864 97.6365Z"
        fill="url(#gradient2)"
      />
      <Path
        d="M113.271 67.4181C114.836 56.9571 106.871 51.3335 95.9802 47.582L99.513 33.4113L90.8873 31.2616L87.4478 45.0589C85.1802 44.4938 82.8511 43.9607 80.5369 43.4325L84.0009 29.5443L75.3801 27.3946L71.8448 41.5604C69.9678 41.1329 68.1252 40.7104 66.3366 40.2657L66.3465 40.2215L54.4507 37.2512L52.1561 46.4641C52.1561 46.4641 58.556 47.9308 58.4209 48.0217C61.9144 48.8939 62.5458 51.2057 62.4402 53.0385L58.416 69.182C58.6567 69.2434 58.9688 69.3319 59.3127 69.4695C59.0253 69.3982 58.7182 69.3196 58.4012 69.2434L52.7605 91.8581C52.333 92.9195 51.2495 94.5115 48.8075 93.9071C48.8935 94.0324 42.5378 92.3421 42.5378 92.3421L38.2556 102.216L49.4807 105.014C51.5689 105.538 53.6154 106.085 55.63 106.601L52.0603 120.934L60.6762 123.084L64.2115 108.903C66.5651 109.542 68.8499 110.132 71.0856 110.687L67.5626 124.801L76.1884 126.951L79.7581 112.645C94.4668 115.429 105.527 114.306 110.183 101.002C113.934 90.2907 109.996 84.1119 102.257 80.0828C107.893 78.7831 112.138 75.0758 113.271 67.4181ZM93.5627 95.0544C90.8971 105.766 72.8619 99.9753 67.0147 98.5234L71.7514 79.5349C77.5985 80.9942 96.3487 83.8834 93.5627 95.0544ZM96.2308 67.2633C93.7986 77.0069 78.7876 72.0565 73.9183 70.8428L78.2127 53.6208C83.0821 54.8344 98.7637 57.0996 96.2308 67.2633Z"
        fill={surface}
      />
    </Svg>
  );
}

export function DollarMaskIcon() {
  const [surfaceSecondary, surfaceTertiary, surface] = useThemeColor([
    'surface-secondary',
    'surface-tertiary',
    'surface',
  ] as const);

  return (
    <Svg width="150" height="150" viewBox="0 0 158 158" fill="none">
      <Defs>
        <LinearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop stopOpacity={0} offset="0%" stopColor={surfaceSecondary} />
          <Stop stopOpacity={1} offset="100%" stopColor={surfaceTertiary} />
        </LinearGradient>
      </Defs>
      <Path
        d="M154.864 97.6365C144.364 139.753 101.707 165.385 59.5855 154.882C17.4811 144.382 -8.15047 101.722 2.35473 59.6079C12.8501 17.4864 55.5072 -8.14769 97.6165 2.35261C139.736 12.8529 165.365 55.5174 154.864 97.6365Z"
        fill="url(#gradient2)"
      />
      <Path
        d="M59.6088 123.539L61.9469 114.088C57.4053 111.529 53.9555 108.145 51.5975 103.936C49.2396 99.726 47.8184 94.9361 47.334 89.5659L62.4836 87.8751C63.1327 91.5107 64.4166 94.718 66.3354 97.4968C68.2541 100.276 70.6906 102.031 73.6449 102.762C76.4923 103.466 78.9464 103.318 81.0072 102.317C83.0767 101.28 84.4374 99.4449 85.0891 96.811C85.5734 94.8534 85.4046 93.093 84.5827 91.5298C83.7695 89.931 82.4896 88.3868 80.743 86.897C79.0319 85.416 77.0495 83.8868 74.7958 82.3093C72.524 80.6518 70.2877 78.9276 68.0868 77.1365C65.8859 75.3455 63.9602 73.3581 62.3097 71.1744C60.6948 68.9996 59.5726 66.5123 58.9433 63.7125C58.3584 60.8859 58.5151 57.6574 59.4134 54.0269C60.523 49.5421 62.9329 45.8323 66.6431 42.8975C70.362 39.9271 75.0097 38.5463 80.5861 38.7551L82.6865 30.2661L97.5289 33.9385L95.4021 42.5343C99.4539 44.7832 102.405 47.7419 104.254 51.4102C106.104 55.0785 107.123 59.0512 107.311 63.3283L92.5207 64.4847C92.1949 62.1378 91.3493 59.9833 89.9839 58.0212C88.6273 56.0236 86.5787 54.6857 83.838 54.0076C81.5244 53.4352 79.6036 53.4888 78.0757 54.1683C76.5566 54.8123 75.568 56.0597 75.1101 57.9106C74.7402 59.4055 74.9748 60.8234 75.814 62.1642C76.6532 63.505 77.8704 64.8449 79.4655 66.1838C81.105 67.496 82.9268 68.8344 84.9311 70.1991C87.0957 71.679 89.3096 73.341 91.5729 75.1853C93.8718 77.0384 95.8957 79.1633 97.6445 81.5602C99.4022 83.9215 100.614 86.6576 101.279 89.7685C101.981 92.8882 101.829 96.4769 100.825 100.535C99.8038 104.663 98.0779 108.051 95.6476 110.698C93.253 113.354 90.4075 115.313 87.1113 116.575C83.815 117.837 80.3348 118.393 76.6705 118.241L74.4512 127.211L59.6088 123.539Z"
        fill={surface}
      />
    </Svg>
  );
}

export function EuroMaskIcon() {
  const [surfaceSecondary, surfaceTertiary, surface] = useThemeColor([
    'surface-secondary',
    'surface-tertiary',
    'surface',
  ] as const);

  return (
    <Svg width="158" height="158" viewBox="0 0 158 158" fill="none">
      <Defs>
        <LinearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop stopOpacity={0} offset="0%" stopColor={surfaceSecondary} />
          <Stop stopOpacity={1} offset="100%" stopColor={surfaceTertiary} />
        </LinearGradient>
      </Defs>
      <Path
        d="M154.864 97.6365C144.364 139.753 101.707 165.385 59.5855 154.882C17.4811 144.382 -8.15047 101.722 2.35473 59.6079C12.8501 17.4864 55.5072 -8.14769 97.6165 2.35261C139.736 12.8529 165.365 55.5174 154.864 97.6365Z"
        fill="url(#gradient3)"
      />
      <Path
        d="M77.2594 119.067C71.9204 117.746 67.6911 115.604 64.5713 112.641C61.496 109.652 59.3662 106.047 58.1821 101.825C56.998 97.604 56.5955 92.9717 56.9745 87.9285L46.9906 85.4582L54.185 76.3032L58.0291 77.2543C58.1608 76.5692 58.275 75.9553 58.3715 75.4126C58.5036 74.8787 58.6092 74.4516 58.6885 74.1313C58.7678 73.8109 58.8558 73.455 58.9527 73.0635C59.0852 72.6807 59.2749 72.0667 59.5218 71.2212L50.9794 69.1076L58.1469 59.8326L63.5927 61.18C65.1584 57.7524 67.0406 54.6487 69.2394 51.8687C71.4381 49.0888 73.9314 46.7972 76.7195 44.994C79.5519 43.1641 82.6837 41.9559 86.115 41.3696C89.5819 40.792 93.3619 41.0096 97.4552 42.0224C100.659 42.815 103.828 44.2035 106.963 46.1879C110.107 48.1367 113.173 50.8594 116.16 54.356L107.705 66.0886C106.027 63.7094 104.137 61.6552 102.034 59.9262C99.9399 58.1616 97.2556 56.8742 93.981 56.064C91.881 55.5444 89.9246 55.5891 88.1119 56.1983C86.308 56.7718 84.652 57.8163 83.1439 59.3318C81.6446 60.8116 80.3061 62.6335 79.1286 64.7974L104.329 71.0324L97.3754 80.5871L74.738 74.986C74.5083 75.6091 74.3228 76.1298 74.1815 76.5481C74.0758 76.9752 73.9658 77.4202 73.8513 77.8829C73.7368 78.3456 73.6135 78.8439 73.4814 79.3778C73.3849 79.9205 73.3062 80.4676 73.2453 81.0191L93.5335 86.0389L86.7001 95.5665L72.5517 92.0659C72.504 94.396 72.7892 96.4496 73.4071 98.2267C74.0606 100.013 75.0024 101.473 76.2324 102.609C77.4624 103.744 78.9494 104.527 80.6935 104.959C83.185 105.575 85.5503 105.481 87.7894 104.675C90.0641 103.878 92.3551 102.48 94.6624 100.483L104.411 110.317C100.791 113.954 96.6314 116.646 91.9312 118.391C87.2755 120.11 82.3849 120.335 77.2594 119.067Z"
        fill={surface}
      />
    </Svg>
  );
}

export function PoundMaskIcon() {
  const [surfaceSecondary, surfaceTertiary, surface] = useThemeColor([
    'surface-secondary',
    'surface-tertiary',
    'surface',
  ] as const);

  return (
    <Svg width="158" height="158" viewBox="0 0 158 158" fill="none">
      <Defs>
        <LinearGradient id="gradient4" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop stopOpacity={0} offset="0%" stopColor={surfaceSecondary} />
          <Stop stopOpacity={1} offset="100%" stopColor={surfaceTertiary} />
        </LinearGradient>
      </Defs>
      <Path
        d="M154.864 97.6365C144.364 139.753 101.707 165.385 59.5855 154.882C17.4811 144.382 -8.15047 101.722 2.35473 59.6079C12.8501 17.4864 55.5072 -8.14769 97.6165 2.35261C139.736 12.8529 165.365 55.5174 154.864 97.6365Z"
        fill="url(#gradient4)"
      />
      <Path
        d="M45.5424 109.86L48.9638 96.0316C50.8216 95.6981 52.4652 95.0093 53.8944 93.9654C55.368 92.8947 56.6233 91.6377 57.6603 90.1945C58.6973 88.7513 59.5475 87.2997 60.2109 85.8396C60.3966 85.3945 60.5557 84.9806 60.6881 84.5979C60.8294 84.1796 60.9309 83.8459 60.9925 83.5967L52.1832 81.4171L55.5517 67.8026L60.9441 69.1368C60.9166 68.7901 60.8709 68.2877 60.807 67.6298C60.7876 66.9451 60.7593 66.2959 60.7223 65.6824C60.6566 64.2686 60.6531 62.8324 60.7118 61.3738C60.8149 59.8884 61.0514 58.3983 61.4213 56.9033C62.346 53.166 64.1209 49.8091 66.746 46.8324C69.3711 43.8558 72.8387 41.7486 77.1488 40.5109C81.4677 39.2376 86.5814 39.3319 92.4899 40.7938C97.6154 42.062 101.875 43.8525 105.269 46.1653C108.707 48.4514 111.92 51.3427 114.908 54.8393L105.787 67.4272C104.663 66.016 103.357 64.5029 101.868 62.888C100.388 61.2375 98.592 59.7167 96.481 58.3256C94.3787 56.8989 91.8683 55.8245 88.9497 55.1024C86.4225 54.4771 84.2968 54.3667 82.5726 54.771C80.8483 55.1754 79.4805 55.8946 78.4692 56.9286C77.4579 57.9627 76.7938 59.1204 76.4767 60.4018C76.283 61.1848 76.1652 62.1189 76.1234 63.2039C76.1171 64.2978 76.214 65.7382 76.414 67.5252C76.5582 68.3163 76.7026 69.183 76.8472 70.1254C76.9917 71.0677 77.1543 72.09 77.3348 73.1923L95.5408 77.6968L92.1723 91.3113L76.0485 87.3219C76.0133 87.4643 75.925 87.7446 75.7838 88.1629C75.6425 88.5813 75.4568 89.0264 75.2268 89.4982C74.4668 91.501 73.5109 93.3798 72.3591 95.1345C71.2073 96.8892 69.7841 98.5956 68.0896 100.254L101.832 108.603L98.2918 122.911L45.5424 109.86Z"
        fill={surface}
      />
    </Svg>
  );
}

export function LightningUnit({
  style,
  color,
  width = 24,
  height = 24,
}: {
  style?: StyleProp<ViewStyle>;
  color?: string;
  width?: number;
  height?: number;
}) {
  return (
    <Svg
      style={style}
      viewBox="0 0 360 360"
      height={width}
      width={height}
      fill={color}
      transform="translate(0,2)">
      <Rect x="166.06" y="2.83" width="27.89" height="47.65"></Rect>
      <Rect x="166.06" y="310.35" width="27.89" height="47.65"></Rect>
      <Rect
        x="166.06"
        y="6.84"
        width="27.89"
        height="198.86"
        transform="translate(286.28 -73.74) rotate(90)"></Rect>
      <Rect
        x="166.06"
        y="80.5"
        width="27.89"
        height="198.86"
        transform="translate(359.94 -0.08) rotate(90)"></Rect>
      <Rect
        x="166.06"
        y="152.08"
        width="27.89"
        height="198.86"
        transform="translate(431.52 71.5) rotate(90)"></Rect>
    </Svg>
  );
}

export function CurrencyIcon({
  width = 36,
  currency,
  colors,
  iconColor,
}: {
  width?: number;
  currency?: string;
  colors?: string[];
  /** Override for inner symbol/icon color (e.g. #FFFFFF for QR code on dark surface) */
  iconColor?: string;
}) {
  const [foreground, surfaceForeground, defaultForeground] = useThemeColor([
    'foreground',
    'surface-foreground',
    'default-foreground',
  ] as const);
  const [shade200, shade300, orange200, orange300, orange400] = useThemeColor([
    'shade-200',
    'shade-300',
    'orange-200',
    'orange-300',
    'orange-400',
  ] as const);
  const gradientColors =
    colors ??
    (currency === 'sat' ? [orange200, orange300, orange400] : [shade200, shade300, shade300]);
  const [g0, g1, g2] = [
    gradientColors[0],
    gradientColors[1] ?? gradientColors[0],
    gradientColors[2] ?? gradientColors[1] ?? gradientColors[0],
  ];
  // The bitcoin disc is always orange (branded), so its inner "B" must
  // always be white — otherwise the light-theme `foreground` (near-black)
  // paints a black B on the orange disc, which is wrong. Other currencies
  // still pick up the theme foreground so they invert with dark/light.
  const symbolColor = iconColor ?? (currency === 'sat' ? INVARIANT_WHITE : foreground);
  /** When iconColor is passed (QR mode): background = text color, symbol = surface color */
  const symbolFill = iconColor != null ? g0 : symbolColor;

  if (currency === 'eur') {
    return (
      <View
        style={{
          width: width,
        }}>
        <Svg
          viewBox="0 0 33 33"
          fill="none"
          style={{
            transform: [{ scale: 1 }],
            zIndex: 1000,
          }}>
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={g0} />
              <Stop offset="50%" stopColor={g1} />
              <Stop offset="100%" stopColor={g2} />
            </LinearGradient>
          </Defs>
          <Path
            d="M32.5061 20.4939C30.3021 29.3342 21.3484 34.7143 12.507 32.5098C3.6693 30.3058 -1.71079 21.3515 0.494259 12.5117C2.69724 3.6704 11.651 -1.7102 20.4897 0.493813C29.3306 2.69783 34.7101 11.6531 32.5061 20.4939Z"
            fill={iconColor ?? 'url(#gradient)'}
          />
          <Path
            d="M15.3039 25.7452C14.0481 25.4087 13.0584 24.8833 12.3346 24.169C11.6215 23.4485 11.1346 22.5868 10.8739 21.5838C10.6133 20.5809 10.5393 19.4843 10.6518 18.2942L8.30361 17.665L10.0455 15.5343L10.9496 15.7765C10.9838 15.6152 11.0136 15.4707 11.0388 15.3428C11.0725 15.2173 11.0994 15.1168 11.1196 15.0415C11.1398 14.9661 11.1622 14.8824 11.1869 14.7903C11.2199 14.7005 11.2676 14.5562 11.3298 14.3576L9.32064 13.8192L11.0567 11.66L12.3375 12.0032C12.7231 11.2003 13.182 10.4754 13.7143 9.82839C14.2465 9.18144 14.8462 8.65124 15.5132 8.23781C16.1909 7.81824 16.9365 7.54698 17.7501 7.42401C18.572 7.3033 19.4643 7.37191 20.427 7.62987C21.1804 7.83175 21.9231 8.1743 22.6549 8.65752C23.3891 9.13237 24.1012 9.78975 24.7913 10.6297L22.7398 13.3638C22.3541 12.7939 21.9167 12.2999 21.4276 11.8817C20.9408 11.4552 20.3123 11.1387 19.5421 10.9324C19.0482 10.8 18.5857 10.8017 18.1545 10.9374C17.7256 11.0647 17.3295 11.304 16.9662 11.6553C16.6052 11.9982 16.2806 12.4227 15.9925 12.9287L21.9194 14.5168L20.2327 16.7431L14.9085 15.3165C14.8514 15.4627 14.8052 15.5849 14.7699 15.6831C14.743 15.7836 14.715 15.8882 14.6858 15.997C14.6566 16.1059 14.6252 16.2231 14.5916 16.3486C14.5663 16.4765 14.5452 16.6054 14.5283 16.7354L19.3 18.014L17.6418 20.2345L14.3142 19.3429C14.2923 19.8933 14.3503 20.3799 14.4883 20.8027C14.6346 21.2277 14.8505 21.5771 15.136 21.851C15.4215 22.1249 15.7694 22.3168 16.1796 22.4267C16.7656 22.5838 17.325 22.5721 17.8578 22.3919C18.3989 22.2139 18.9467 21.8941 19.5011 21.4325L21.7601 23.8009C20.8881 24.644 19.8928 25.2611 18.7742 25.6522C17.6661 26.0372 16.5093 26.0682 15.3039 25.7452Z"
            fill={symbolFill}
          />
        </Svg>
      </View>
    );
  } else if (currency === 'usd') {
    return (
      <View
        style={{
          width: width,
        }}>
        <Svg
          viewBox="0 0 33 33"
          fill="none"
          style={{
            transform: [{ scale: 1 }],
            zIndex: 1000,
          }}>
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={g0} />
              <Stop offset="50%" stopColor={g1} />
              <Stop offset="100%" stopColor={g2} />
            </LinearGradient>
          </Defs>
          <Path
            d="M32.5061 20.4939C30.3021 29.3342 21.3484 34.7143 12.507 32.5098C3.6693 30.3058 -1.71079 21.3515 0.494259 12.5117C2.69724 3.6704 11.651 -1.7102 20.4897 0.493813C29.3306 2.69783 34.7101 11.6531 32.5061 20.4939Z"
            fill={iconColor ?? 'url(#gradient)'}
          />
          <Path
            d="M11.6118 26.7216L12.2074 24.499C11.1457 23.8736 10.3459 23.0581 9.80778 22.0526C9.2697 21.047 8.95564 19.9086 8.8656 18.6373L12.4534 18.3067C12.5903 19.1688 12.8791 19.9326 13.3199 20.598C13.7607 21.2634 14.3285 21.6892 15.0233 21.8754C15.6931 22.0549 16.2737 22.031 16.7652 21.8038C17.259 21.5683 17.5889 21.1407 17.7549 20.5213C17.8783 20.0608 17.8464 19.6441 17.6593 19.2709C17.4744 18.8894 17.1789 18.5186 16.7729 18.1586C16.3753 17.8008 15.9138 17.4304 15.3884 17.0474C14.8591 16.6454 14.3384 16.2277 13.8264 15.7944C13.3145 15.3612 12.8684 14.8828 12.4883 14.3592C12.1166 13.8379 11.8627 13.245 11.7267 12.5805C11.6014 11.9098 11.6531 11.1476 11.8819 10.2937C12.1645 9.23892 12.7509 8.37319 13.641 7.69652C14.5334 7.01147 15.638 6.7063 16.9549 6.78101L17.4899 4.78444L20.9807 5.71982L20.439 7.7415C21.3863 8.29141 22.0702 9.00402 22.4906 9.87933C22.9111 10.7546 23.1338 11.6981 23.1588 12.7097L19.6582 12.9157C19.5919 12.3596 19.4019 11.8466 19.0881 11.3767C18.7766 10.8985 18.2986 10.573 17.654 10.4003C17.1098 10.2545 16.6557 10.2584 16.2915 10.412C15.9296 10.5573 15.6903 10.8476 15.5736 11.2829C15.4794 11.6345 15.5284 11.9707 15.7207 12.2913C15.9129 12.612 16.1944 12.9342 16.5653 13.2579C16.9468 13.5754 17.3712 13.9 17.8386 14.2316C18.3434 14.5912 18.8591 14.994 19.3856 15.4402C19.9204 15.8885 20.389 16.3999 20.7914 16.9743C21.196 17.5403 21.4699 18.1924 21.6131 18.9306C21.7646 19.6711 21.7125 20.5185 21.4568 21.4728C21.1966 22.4439 20.7733 23.2367 20.1869 23.8512C19.6089 24.4679 18.9276 24.9179 18.1429 25.2011C17.3582 25.4844 16.5332 25.5998 15.6679 25.5474L15.1027 27.657L11.6118 26.7216Z"
            fill={symbolFill}
          />
        </Svg>
      </View>
    );
  } else if (currency === 'gbp') {
    return (
      <View
        style={{
          width: width,
        }}>
        <Svg
          viewBox="0 0 33 33"
          fill="none"
          style={{
            transform: [{ scale: 1 }],
            zIndex: 1000,
          }}>
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={g0} />
              <Stop offset="50%" stopColor={g1} />
              <Stop offset="100%" stopColor={g2} />
            </LinearGradient>
          </Defs>
          <Path
            d="M32.5066 20.4939C30.3026 29.3342 21.3488 34.7143 12.5075 32.5098C3.66979 30.3058 -1.7103 21.3515 0.494747 12.5117C2.69773 3.6704 11.6515 -1.7102 20.4902 0.493813C29.331 2.69783 34.7106 11.6531 32.5066 20.4939Z"
            fill={iconColor ?? 'url(#gradient)'}
          />
          <Path
            d="M8.35038 23.425L9.22183 20.1727C9.66239 20.1024 10.0539 19.9471 10.3964 19.7069C10.7495 19.4605 11.0519 19.1692 11.3035 18.8329C11.5552 18.4965 11.7627 18.1574 11.9261 17.8153C11.972 17.711 12.0115 17.6139 12.0445 17.5241C12.0798 17.4258 12.1053 17.3474 12.121 17.2888L10.0491 16.7337L10.9071 13.5316L12.1754 13.8715C12.1704 13.7894 12.1619 13.6705 12.1498 13.5147C12.1483 13.3528 12.1446 13.1993 12.1387 13.0541C12.1296 12.7197 12.1353 12.3803 12.1558 12.0358C12.1869 11.6853 12.2496 11.3342 12.3438 10.9826C12.5793 10.1036 13.014 9.31837 13.6479 8.62688C14.2818 7.93538 15.1109 7.45319 16.1351 7.18031C17.1615 6.89905 18.3696 6.9446 19.7592 7.31696C20.9647 7.63996 21.9632 8.08247 22.7547 8.64448C23.5568 9.20036 24.3029 9.89825 24.9931 10.7382L22.7805 13.6714C22.5213 13.3328 22.2194 12.9693 21.8749 12.5809C21.5326 12.1841 21.1152 11.8166 20.6226 11.4782C20.1323 11.1315 19.5439 10.8662 18.8575 10.6822C18.2631 10.523 17.7613 10.4872 17.3519 10.5749C16.9426 10.6626 16.6161 10.8264 16.3724 11.0661C16.1287 11.3059 15.9665 11.5765 15.8858 11.8778C15.8364 12.062 15.8043 12.2822 15.7895 12.5384C15.7831 12.7969 15.7994 13.1378 15.8385 13.561C15.869 13.7486 15.8992 13.9541 15.9291 14.1774C15.959 14.4008 15.9927 14.6431 16.0304 14.9044L20.3123 16.0517L19.4543 19.2538L15.6621 18.2377C15.6531 18.2712 15.631 18.337 15.5957 18.4352C15.5604 18.5334 15.5145 18.6378 15.458 18.7482C15.2693 19.2181 15.0349 19.6577 14.7547 20.0671C14.4745 20.4766 14.1304 20.8734 13.7224 21.2575L21.6585 23.384L20.7567 26.7493L8.35038 23.425Z"
            fill={symbolFill}
          />
        </Svg>
      </View>
    );
  } else if (currency === 'sat') {
    return (
      <View
        style={{
          width: width,
          height: width,
        }}>
        <Svg
          viewBox="0 0 33 33"
          fill="none"
          style={{
            zIndex: 1000,
          }}>
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={g0} />
              <Stop offset="50%" stopColor={g1} />
              <Stop offset="100%" stopColor={g2} />
            </LinearGradient>
          </Defs>
          <Path
            d="M32.5061 20.4939C30.3021 29.3342 21.3484 34.7143 12.507 32.5098C3.6693 30.3058 -1.71079 21.3515 0.494259 12.5117C2.69724 3.6704 11.651 -1.7102 20.4897 0.493813C29.3306 2.69783 34.7101 11.6531 32.5061 20.4939Z"
            fill={iconColor ?? 'url(#gradient)'}
          />
          <Path
            d="M23.7756 14.1508C24.104 11.9551 22.4322 10.7747 20.1462 9.98722L20.8877 7.01278L19.0772 6.56156L18.3552 9.45762C17.8793 9.33901 17.3904 9.22711 16.9046 9.11624L17.6317 6.2011L15.8222 5.74988L15.0802 8.72329C14.6862 8.63356 14.2994 8.54486 13.924 8.45153L13.9261 8.44224L11.4291 7.81879L10.9475 9.75259C10.9475 9.75259 12.2908 10.0604 12.2625 10.0795C12.9958 10.2626 13.1283 10.7478 13.1061 11.1325L12.2615 14.5211C12.312 14.534 12.3775 14.5525 12.4497 14.5814C12.3893 14.5665 12.3249 14.55 12.2584 14.534L11.0744 19.2808C10.9846 19.5036 10.7572 19.8377 10.2446 19.7109C10.2627 19.7372 8.92862 19.3824 8.92862 19.3824L8.02979 21.4549L10.3859 22.0423C10.8243 22.1521 11.2538 22.2671 11.6767 22.3754L10.9274 25.3839L12.7359 25.8351L13.4779 22.8586C13.972 22.9927 14.4515 23.1164 14.9208 23.233L14.1813 26.1956L15.9919 26.6468L16.7412 23.644C19.8285 24.2282 22.1501 23.9926 23.1273 21.2002C23.9148 18.9518 23.0882 17.6549 21.4638 16.8091C22.6467 16.5364 23.5378 15.7582 23.7756 14.1508ZM19.6388 19.9517C19.0793 22.2001 15.2937 20.9846 14.0663 20.6798L15.0606 16.6942C16.2879 17.0005 20.2236 17.6069 19.6388 19.9517ZM20.1988 14.1183C19.6883 16.1635 16.5375 15.1244 15.5154 14.8697L16.4168 11.2548C17.4389 11.5095 20.7305 11.985 20.1988 14.1183Z"
            fill={symbolFill}
          />
        </Svg>
      </View>
    );
  } else if (currency === 'p2pk') {
    return (
      <View
        style={{
          width: width,
          height: width,
          position: 'relative',
        }}>
        <Svg
          width={width}
          height={width}
          viewBox="0 0 33 33"
          fill="none"
          style={{
            position: 'absolute',
            zIndex: 1,
          }}>
          <Defs>
            <LinearGradient id="gradient-p2pk" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={g0} />
              <Stop offset="50%" stopColor={g1} />
              <Stop offset="100%" stopColor={g2} />
            </LinearGradient>
          </Defs>
          <Path
            d="M32.5061 20.4939C30.3021 29.3342 21.3484 34.7143 12.507 32.5098C3.6693 30.3058 -1.71079 21.3515 0.494259 12.5117C2.69724 3.6704 11.651 -1.7102 20.4897 0.493813C29.3306 2.69783 34.7101 11.6531 32.5061 20.4939Z"
            fill={iconColor ?? 'url(#gradient-p2pk)'}
          />
        </Svg>
        <View
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2,
          }}>
          <Icon name="solar:key-bold" size={width * 0.5} color={symbolFill} />
        </View>
      </View>
    );
  } else if (currency === 'nostr') {
    return (
      <View
        style={{
          width: width,
          height: width,
        }}>
        <Svg
          viewBox="0 0 33 33"
          fill="none"
          style={{
            transform: [{ scale: 1 }],
            zIndex: 1000,
          }}>
          <Defs>
            <LinearGradient id="gradient-nostr" x1="0%" y1="0%" x2="100%" y2="0%">
              {gradientColors.map((color, index) => (
                <Stop key={index} offset={`${index * 25}%`} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          {iconColor != null ? (
            <>
              <Path
                d="M16.5 0C7.38796 0 0 7.38796 0 16.5C0 25.612 7.38796 33 16.5 33C25.612 33 33 25.612 33 16.5C33 7.38796 25.612 0 16.5 0Z"
                fill={iconColor}
              />
              <Path
                d="M25.9757 12.7117C25.2787 13.8701 23.8577 14.6581 23.7263 14.7254C23.4603 14.8668 23.3627 15.0722 23.3795 15.3787C23.3963 15.6851 23.3222 17.2038 22.3962 17.8739C21.9214 18.2173 20.0054 18.6618 19.1265 18.81C18.6753 18.8875 18.5709 19.0255 18.3217 19.1737V19.1737C17.318 19.796 18.1695 20.9195 19.2993 20.5756C19.9431 20.3796 20.4636 20.2239 20.524 20.2142C20.9685 20.1468 21.3052 20.2748 21.5241 20.5981C21.7329 20.9079 21.9383 21.221 22.1437 21.5342C22.2178 21.6453 22.2885 21.7598 22.3592 21.8743L22.4333 21.9921C22.4602 22.0359 22.4972 22.0864 22.5141 22.1538C22.5276 22.2009 22.5579 22.3592 22.4669 22.4535C22.3828 22.541 22.238 22.541 22.1605 22.5208C22.0864 22.5006 21.9753 22.4568 21.8844 22.3828L21.7598 22.2784C21.6621 22.1942 21.4769 22.1538 21.3321 22.1605C21.1638 22.1672 20.9415 22.1134 20.8338 22.046C20.7466 21.9898 20.6864 21.8983 20.6459 21.8106C20.5759 21.6589 20.5564 21.4298 20.3893 21.4298V21.4298C20.2546 21.4264 20.1502 21.4668 20.0424 21.4971C19.5508 21.6453 19.0626 21.7968 18.5709 21.9517L17.8671 22.1706C17.5203 22.2784 17.1735 22.3861 16.83 22.5006C16.7357 22.5309 16.6448 22.5781 16.5471 22.6286C16.5067 22.6488 16.4663 22.669 16.4259 22.6892C16.3855 22.7094 16.3417 22.733 16.3013 22.7565C16.2104 22.807 16.1128 22.8609 16.005 22.8912C15.6548 22.9956 15.3484 22.8441 15.2036 22.4939C15.1093 22.2683 15.1935 21.8204 15.244 21.6891C15.366 21.3723 15.5941 20.9475 15.8284 20.5444C16.2692 19.7859 15.9614 19.3619 15.2642 19.8943V19.8943C14.7557 20.2815 13.5637 21.1974 13.5468 21.285C13.4694 21.6924 13.2168 21.9989 12.8296 22.1504V22.1504C12.3119 22.35 12.0544 22.9196 11.728 23.3682C10.8722 24.5445 9.17828 26.8676 9.02786 27.0331C8.96724 27.1004 8.40827 27.6863 8.2601 27.9591C8.22643 28.0264 8.09847 28.2958 8.0648 28.3632C8.03786 28.417 7.97725 28.5618 7.74827 28.5517C7.51929 28.5416 7.51255 28.2217 7.50245 28.0837C7.47888 27.7436 7.55296 27.4102 7.73143 27.06C7.74826 27.0263 7.95031 26.7199 7.87622 26.4741C7.80888 26.2586 7.7449 25.9252 7.84592 25.7568C8.00418 25.4908 8.28367 25.4807 8.65745 25.4201C8.91674 25.3763 9.10531 25.2484 9.28714 24.9823C9.67102 24.4234 11.1156 22.3727 11.4422 21.8979C11.5298 21.7733 11.5971 21.6116 11.6274 21.4534C11.7217 20.9752 12.0113 20.6418 12.5164 20.4364C12.6242 20.3927 14.6345 18.7123 14.6345 18.4968C14.6345 18.3419 14.4156 18.2578 14.2472 18.2106C14.2237 18.2039 12.9609 17.8772 12.3851 17.6146C12.0719 17.4732 11.8362 17.3486 11.5567 17.1465C11.1762 16.867 10.4152 17.0017 10.3041 17.0186C9.76531 17.096 9.36459 17.3385 8.91 17.6449C8.82918 17.7021 8.415 17.8503 8.20623 17.7324C7.79878 17.5001 6.90306 17.0826 6.57306 16.5808C6.42153 16.3485 6.44173 15.9713 6.54949 15.5538C6.89633 14.584 7.40816 14.1496 8.35439 13.8869C8.39092 13.8743 8.42946 13.8623 8.4698 13.8507C10.124 13.3765 12.0159 13.7703 13.5468 12.9845V12.9845C14.2237 12.6377 16.234 11.3008 19.1265 11.3917C20.295 11.4288 22.504 12.5703 23.3559 12.604C24.2247 12.641 24.6591 12.5434 25.1608 12.0248C25.3022 11.8766 25.905 10.5768 25.3359 9.86633C25.1238 9.60367 24.9049 9.36796 24.6523 9.15245C24.3122 8.86286 23.9587 8.58673 23.6522 8.2601C22.9754 7.54286 22.7666 6.56296 23.0865 5.79857C23.2919 5.26316 23.723 5.03082 24.3459 5.15204C24.7837 5.23622 25.1036 5.6302 25.4167 5.83898C25.5918 5.95684 25.8848 6.02418 26.0767 6.07133C26.3192 6.12857 26.501 6.31378 26.4909 6.43837C26.4808 6.56296 26.1609 6.67071 25.8545 6.64714C25.4908 6.62357 24.8679 6.6202 24.4941 6.7448C24.2449 6.83572 24.1338 7.11184 24.2079 7.38459C24.2685 7.60684 24.7433 8.00418 24.9217 8.15235C25.2787 8.44531 25.6592 8.71133 25.9555 9.07837C26.2889 9.49592 26.464 9.97071 26.5179 10.496C26.5987 11.3008 26.3865 12.0248 25.9757 12.7117Z"
                fill={symbolFill}
              />
            </>
          ) : (
            <Path
              d="M16.5 0C7.38796 0 0 7.38796 0 16.5C0 25.612 7.38796 33 16.5 33C25.612 33 33 25.612 33 16.5C33 7.38796 25.612 0 16.5 0ZM25.9757 12.7117C25.2787 13.8701 23.8577 14.6581 23.7263 14.7254C23.4603 14.8668 23.3627 15.0722 23.3795 15.3787C23.3963 15.6851 23.3222 17.2038 22.3962 17.8739C21.9214 18.2173 20.0054 18.6618 19.1265 18.81C18.6753 18.8875 18.5709 19.0255 18.3217 19.1737V19.1737C17.318 19.796 18.1695 20.9195 19.2993 20.5756C19.9431 20.3796 20.4636 20.2239 20.524 20.2142C20.9685 20.1468 21.3052 20.2748 21.5241 20.5981C21.7329 20.9079 21.9383 21.221 22.1437 21.5342C22.2178 21.6453 22.2885 21.7598 22.3592 21.8743L22.4333 21.9921C22.4602 22.0359 22.4972 22.0864 22.5141 22.1538C22.5276 22.2009 22.5579 22.3592 22.4669 22.4535C22.3828 22.541 22.238 22.541 22.1605 22.5208C22.0864 22.5006 21.9753 22.4568 21.8844 22.3828L21.7598 22.2784C21.6621 22.1942 21.4769 22.1538 21.3321 22.1605C21.1638 22.1672 20.9415 22.1134 20.8338 22.046C20.7466 21.9898 20.6864 21.8983 20.6459 21.8106C20.5759 21.6589 20.5564 21.4298 20.3893 21.4298V21.4298C20.2546 21.4264 20.1502 21.4668 20.0424 21.4971C19.5508 21.6453 19.0626 21.7968 18.5709 21.9517L17.8671 22.1706C17.5203 22.2784 17.1735 22.3861 16.83 22.5006C16.7357 22.5309 16.6448 22.5781 16.5471 22.6286C16.5067 22.6488 16.4663 22.669 16.4259 22.6892C16.3855 22.7094 16.3417 22.733 16.3013 22.7565C16.2104 22.807 16.1128 22.8609 16.005 22.8912C15.6548 22.9956 15.3484 22.8441 15.2036 22.4939C15.1093 22.2683 15.1935 21.8204 15.244 21.6891C15.366 21.3723 15.5941 20.9475 15.8284 20.5444C16.2692 19.7859 15.9614 19.3619 15.2642 19.8943V19.8943C14.7557 20.2815 13.5637 21.1974 13.5468 21.285C13.4694 21.6924 13.2168 21.9989 12.8296 22.1504V22.1504C12.3119 22.35 12.0544 22.9196 11.728 23.3682C10.8722 24.5445 9.17828 26.8676 9.02786 27.0331C8.96724 27.1004 8.40827 27.6863 8.2601 27.9591C8.22643 28.0264 8.09847 28.2958 8.0648 28.3632C8.03786 28.417 7.97725 28.5618 7.74827 28.5517C7.51929 28.5416 7.51255 28.2217 7.50245 28.0837C7.47888 27.7436 7.55296 27.4102 7.73143 27.06C7.74826 27.0263 7.95031 26.7199 7.87622 26.4741C7.80888 26.2586 7.7449 25.9252 7.84592 25.7568C8.00418 25.4908 8.28367 25.4807 8.65745 25.4201C8.91674 25.3763 9.10531 25.2484 9.28714 24.9823C9.67102 24.4234 11.1156 22.3727 11.4422 21.8979C11.5298 21.7733 11.5971 21.6116 11.6274 21.4534C11.7217 20.9752 12.0113 20.6418 12.5164 20.4364C12.6242 20.3927 14.6345 18.7123 14.6345 18.4968C14.6345 18.3419 14.4156 18.2578 14.2472 18.2106C14.2237 18.2039 12.9609 17.8772 12.3851 17.6146C12.0719 17.4732 11.8362 17.3486 11.5567 17.1465C11.1762 16.867 10.4152 17.0017 10.3041 17.0186C9.76531 17.096 9.36459 17.3385 8.91 17.6449C8.82918 17.7021 8.415 17.8503 8.20623 17.7324C7.79878 17.5001 6.90306 17.0826 6.57306 16.5808C6.42153 16.3485 6.44173 15.9713 6.54949 15.5538C6.89633 14.584 7.40816 14.1496 8.35439 13.8869C8.39092 13.8743 8.42946 13.8623 8.4698 13.8507C10.124 13.3765 12.0159 13.7703 13.5468 12.9845V12.9845C14.2237 12.6377 16.234 11.3008 19.1265 11.3917C20.295 11.4288 22.504 12.5703 23.3559 12.604C24.2247 12.641 24.6591 12.5434 25.1608 12.0248C25.3022 11.8766 25.905 10.5768 25.3359 9.86633C25.1238 9.60367 24.9049 9.36796 24.6523 9.15245C24.3122 8.86286 23.9587 8.58673 23.6522 8.2601C22.9754 7.54286 22.7666 6.56296 23.0865 5.79857C23.2919 5.26316 23.723 5.03082 24.3459 5.15204C24.7837 5.23622 25.1036 5.6302 25.4167 5.83898C25.5918 5.95684 25.8848 6.02418 26.0767 6.07133C26.3192 6.12857 26.501 6.31378 26.4909 6.43837C26.4808 6.56296 26.1609 6.67071 25.8545 6.64714C25.4908 6.62357 24.8679 6.6202 24.4941 6.7448C24.2449 6.83572 24.1338 7.11184 24.2079 7.38459C24.2685 7.60684 24.7433 8.00418 24.9217 8.15235C25.2787 8.44531 25.6592 8.71133 25.9555 9.07837C26.2889 9.49592 26.464 9.97071 26.5179 10.496C26.5987 11.3008 26.3865 12.0248 25.9757 12.7117Z"
              fill="url(#gradient-nostr)"
            />
          )}
        </Svg>
      </View>
    );
  }

  switch (currency) {
    case 'euro':
      return (
        <Svg width="64" height="64" viewBox="0 0 48 48">
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={surfaceForeground} />
              <Stop offset="100%" stopColor={defaultForeground} />
            </LinearGradient>
          </Defs>
          <Path
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M28.525 30.695a5.89 5.89 0 0 1-4.516 2.102h0a5.9 5.9 0 0 1-5.9-5.9v-5.794a5.9 5.9 0 0 1 5.9-5.9h0a5.89 5.89 0 0 1 4.535 2.125M15.91 21.862h6.598M15.91 26.18h6.598"
          />
          <Circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Svg>
      );
    case 'eur':
      return (
        <Svg width="64" height="64" viewBox="0 0 48 48">
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={surfaceForeground} />
              <Stop offset="100%" stopColor={defaultForeground} />
            </LinearGradient>
          </Defs>
          <Path
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M28.525 30.695a5.89 5.89 0 0 1-4.516 2.102h0a5.9 5.9 0 0 1-5.9-5.9v-5.794a5.9 5.9 0 0 1 5.9-5.9h0a5.89 5.89 0 0 1 4.535 2.125M15.91 21.862h6.598M15.91 26.18h6.598"
          />
          <Circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Svg>
      );
    case 'gbp':
      return (
        <Svg width="64" height="64" viewBox="0 0 48 48">
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={surfaceForeground} />
              <Stop offset="100%" stopColor={defaultForeground} />
            </LinearGradient>
          </Defs>
          <Path
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M29.828 19.822a4.62 4.62 0 0 0-4.618-4.619h0a4.62 4.62 0 0 0-4.619 4.619v8.307c0 .96-.314 1.893-.894 2.658l-1.525 2.01h11.656m-6.818-8.192h-4.838"
          />
          <Circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Svg>
      );
    case 'usd':
      return (
        <Svg width="64" height="64" viewBox="0 0 48 48">
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={surfaceForeground} />
              <Stop offset="100%" stopColor={defaultForeground} />
            </LinearGradient>
          </Defs>
          <Path
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M18.52 30.877c1.08 1.404 2.432 1.928 4.314 1.928h2.605a4.394 4.394 0 0 0 4.389-4.399h0a4.394 4.394 0 0 0-4.39-4.398h-2.877a4.394 4.394 0 0 1-4.39-4.399h0a4.394 4.394 0 0 1 4.39-4.398h2.605c1.882 0 3.235.523 4.313 1.927M24 34.996V13.004"
          />
          <Circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Svg>
      );
    case 'sat':
      return (
        <Svg width="64" height="64" viewBox="0 0 48 48">
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={surfaceForeground} />
              <Stop offset="100%" stopColor={defaultForeground} />
            </LinearGradient>
          </Defs>
          <Path
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M26.53 24a4.399 4.399 0 0 1 0 8.797h-7.258V15.203h7.257a4.399 4.399 0 0 1 0 8.797m0 0h-7.257m0 8.797h-2.2m2.2-17.594h-2.2m4.399 19.793v-2.199m4.398 2.199v-2.199m-4.398-17.594v-2.199m4.398 2.199v-2.199"
          />
          <Circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke="url(#gradient)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Svg>
      );
  }

  return null;
}

export function BtcIcon({
  size = 34,
  color,
  weight,
}: {
  size: number;
  color: string;
  weight: string;
}) {
  const foreground = useThemeColor('foreground');
  const iconName =
    weight === 'heavy'
      ? 'material-symbols:currency-bitcoin'
      : 'material-symbols-light:currency-bitcoin';

  return <Icon name={iconName} color={color || foreground} size={size * 1.2} />;
}
