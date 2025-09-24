const { getDefaultConfig } = require('@expo/metro-config');
const { withMonicon } = require('@monicon/metro');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_conditionNames = ['browser', 'require', 'react-native'];

const withStorybook = require('@storybook/react-native/metro/withStorybook');

// First, apply Monicon
const configWithMonicon = withMonicon(config, {
  icons: [
    // Navigation & Arrows
    'fa6-solid:chevron-left',
    'fa6-solid:chevron-right',
    'fluent:chevron-down-12-filled',
    'lucide:arrow-right',
    'lucide:arrow-up-right',
    'mdi:chevron-double-left',
    'mdi:chevron-double-right',

    // Actions & Controls
    'gala:add',
    'gala:remove',
    'fluent:add-24-filled',
    'fluent:arrow-upload-16-filled',
    'fluent:arrow-download-16-filled',
    'fluent:arrow-swap-16-filled',
    'iconamoon:send-fill',
    'ri:share-fill',
    'lets-icons:copy',
    'mage:edit-pen-fill',
    'lucide:pencil-line',
    'lucide:delete',

    // Success & Confirmation
    'simple-line-icons:check',
    'material-symbols:check-rounded',
    'fluent:checkmark-16-filled',
    'ion:checkmark-done',
    'fa6-solid:user-check',

    // Error & Close
    'material-symbols:close-rounded',
    'simple-line-icons:close',
    'nonicons:error-16',
    'mdi:cancel',
    'fluent:dismiss-16-filled',

    // User & Contact
    'ph:user-bold',
    'fa6-solid:user',
    'la:user-plus',
    'la:user-minus',
    'la:user-slash',
    'mdi:contact',

    // Loading & Refresh
    'ant-design:loading-outlined',
    'line-md:uploading-loop',
    'humbleicons:refresh',
    'material-symbols:refresh-rounded',
    'ic:round-refresh',
    'material-symbols:update-rounded',
    'ic:round-cloud-sync',

    // Visibility & Eye
    'majesticons:eye',
    'majesticons:eye-off',

    // Finance & Currency
    'material-symbols:currency-bitcoin',
    'material-symbols-light:currency-bitcoin',
    'fluent:wallet-20-filled',
    'majesticons:coins',
    'solar:card-bold',
    'feather:credit-card',
    'ic:baseline-card-giftcard',
    'ph:contactless-payment-fill',
    'mynaui:contactless-circle-solid',

    // Charts & Analytics
    'material-symbols:pie-chart',
    'radix-icons:half-2',
    'majesticons:percent',

    // Text & Content
    'majesticons:text',
    'mdi:decimal',
    'fluent:emoji-24-filled',

    // Lighting & Bulbs
    'mdi:lightbulb-on-outline',
    'mdi:lightbulb-on',
    'majesticons:lightbulb-shine',
    'majesticons:lightbulb-shine-line',
    'tabler:bulb-filled',
    'tabler:bulb',

    // Media & Photos
    'proicons:photo',

    // Search & Discovery
    'majesticons:search-line',

    // Security & Keys
    'solar:key-bold',
    'ic:baseline-vpn-lock',

    // Social & Communication
    'lucide:twitter',
    'hugeicons:new-twitter',
    'mdi:at',

    // Lightning & Energy
    'mingcute:lightning-fill',

    // Notifications & Alerts
    'famicons:notifications',
    'material-symbols:info-rounded',
    'material-symbols:report-rounded',

    // Documents & Invoice
    'uil:invoice',

    // Settings & Configuration
    'material-symbols:settings-rounded',

    // Charity & Help
    'mdi:charity',
    'mdi:help-circle',

    // Technology & Connectivity
    'fluent:sim-24-filled',
    'feather:wifi',
    'clarity:internet-of-things-solid',

    // Menu & More
    'bx:dots-vertical-rounded',
    'tabler:dots',

    // Time & Clock
    'fluent:clock-12-filled',
    'fluent:clock-16-filled',

    // QR & Codes
    'stash:qr-code',

    // Download & Upload
    'fa6-solid:download',
  ],
});

// Then apply NativeWind
const finalConfig = withNativeWind(configWithMonicon, { input: './global.css' });

module.exports = withStorybook(finalConfig, {
  enabled: process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true',
  onDisabledRemoveStorybook: true,
});
