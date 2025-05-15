const { withMonicon } = require('@monicon/metro');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// eslint-disable-next-line no-undef
const config = getDefaultConfig(__dirname);

// I guess I hate working within a specific icon library...
const configWithMonicon = withMonicon(config, {
  icons: [
    'material-symbols:info-rounded',
    'la:user-slash',
    'material-symbols:report-rounded',
    'fluent:emoji-24-filled',
    'mdi:lightbulb-on-outline',
    'mdi:lightbulb-on',
    'majesticons:lightbulb-shine',
    'majesticons:lightbulb-shine-line',
    'material-symbols:close-rounded',
    'proicons:photo',
    'tabler:bulb-filled',
    'tabler:bulb',
    'solar:card-bold',
    'nonicons:error-16',
    'lucide:pencil-line',
    'majesticons:search-line',
    'solar:key-bold',
    'simple-line-icons:close',
    'ph:user-bold',
    'iconamoon:send-fill',
    'lucide:twitter',
    'mdi:contact',
    'mingcute:lightning-fill',
    'majesticons:coins',
    'famicons:notifications',
    'lucide:delete',
    'ant-design:loading-outlined',
    'line-md:uploading-loop',
    'mdi:decimal',
    'humbleicons:refresh',
    'ri:share-fill',
    'lets-icons:copy',
    'tabler:dots',
    'ph:contactless-payment-fill',
    'mynaui:contactless-circle-solid',
    'material-symbols:currency-bitcoin',
    'material-symbols-light:currency-bitcoin',
    'fluent:wallet-20-filled',
    'material-symbols:settings-rounded',
    'fluent:chevron-down-12-filled',
    'ic:baseline-card-giftcard',
    'lucide:arrow-up-right',
    'mdi:charity',
    'mdi:help-circle',
    'fluent:sim-24-filled',
    'bx:dots-vertical-rounded',
    'mdi:at',
    'lucide:arrow-right',
    'lucide:arrow-up-right',
    'fluent:arrow-upload-16-filled',
    'fluent:arrow-download-16-filled',
    'fluent:arrow-swap-16-filled',
    'gala:add',
    'gala:remove',
    'fluent:clock-12-filled',
    'ic:baseline-vpn-lock',
    'mdi:cancel',
    'clarity:internet-of-things-solid',
    'mage:edit-pen-fill',
    'stash:qr-code',
    'majesticons:eye-off',
    'majesticons:eye',
    'material-symbols-light:currency-bitcoin',
    'fa6-solid:chevron-left',
    'fa6-solid:chevron-right',
    'fluent:add-24-filled',
    'material-symbols:refresh-rounded',
    'ic:round-refresh',
  ]
});

configWithMonicon

module.exports = withNativeWind(configWithMonicon, { input: './global.css' });
