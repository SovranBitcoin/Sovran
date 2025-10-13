const { getDefaultConfig } = require('expo/metro-config'); // Changed this line
const { withMonicon } = require('@monicon/metro');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_conditionNames = ['browser', 'require', 'react-native'];
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs'];

// Add path alias support
config.resolver.alias = {
  '@': __dirname,
};

// First, apply Monicon
const configWithMonicon = withMonicon(config, {
  collections: ['circle-flags'],
  icons: [
    // Your existing icons array...
    'fa6-solid:chevron-left',
    'fa6-solid:chevron-right',
    'fluent:chevron-down-12-filled',
    'lucide:arrow-right',
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
    'material-symbols:check-rounded',
    'fluent:checkmark-16-filled',
    'ion:checkmark-done',
    'material-symbols:close-rounded',
    'simple-line-icons:close',
    'nonicons:error-16',
    'mdi:cancel',
    'ph:user-bold',
    'fa6-solid:user',
    'la:user-plus',
    'la:user-minus',
    'la:user-slash',
    'mdi:contact',
    'ant-design:loading-outlined',
    'humbleicons:refresh',
    'ic:round-refresh',
    'majesticons:eye',
    'majesticons:eye-off',
    'material-symbols:currency-bitcoin',
    'material-symbols-light:currency-bitcoin',
    'fluent:wallet-20-filled',
    'majesticons:coins',
    'solar:card-bold',
    'material-symbols:arrow-back-rounded',
    'material-symbols:close-rounded',
    'material-symbols:verified-rounded',
    'material-symbols:verified',
    'ph:contactless-payment-fill',
    'majesticons:percent',
    'majesticons:text',
    'mdi:decimal',
    'fluent:emoji-24-filled',
    'mdi:lightbulb-on-outline',
    'mdi:lightbulb-on',
    'proicons:photo',
    'majesticons:search-line',
    'solar:key-bold',
    'garden:arrow-retweet-fill-16',
    'garden:speech-bubble-typing-fill-12',
    'garden:heart-fill-16',
    'hugeicons:new-twitter',
    'mdi:at',
    'mingcute:lightning-fill',
    'material-symbols:info-rounded',
    'material-symbols:report-rounded',
    'material-symbols:settings-rounded',
    'mdi:help-circle',
    'feather:wifi',
    'clarity:internet-of-things-solid',
    'bx:dots-vertical-rounded',
    'tabler:dots',
    'fluent:clock-12-filled',
    'stash:qr-code',
    'ic:round-star',
    'humbleicons:url',
  ],
});

// Then apply NativeWind
const finalConfig = withNativeWind(configWithMonicon, { input: './global.css' });

module.exports = finalConfig;
