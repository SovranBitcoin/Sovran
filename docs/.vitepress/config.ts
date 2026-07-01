import { defineConfig } from 'vitepress';

// Base is configurable for GitHub Pages sub-path deploys (e.g. /Sovran/),
// defaulting to root for local dev and custom-domain hosting.
const base = process.env.DOCS_BASE ?? '/';

export default defineConfig({
  base,
  title: 'Sovran Docs',
  description:
    'Bitcoin wallet docs for Cashu ecash, Lightning, Nostr, offline payments, and AI payments',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get Started', link: '/starting/start-here' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Wallet', link: '/wallet/cashu-wallet' },
      { text: 'Protocols', link: '/protocols/nostr' },
    ],
    sidebar: [
      {
        text: 'Starting',
        items: [
          { text: 'Start here', link: '/starting/start-here' },
          { text: 'Install and run', link: '/starting/install-and-run' },
        ],
      },
      {
        text: 'Wallet',
        items: [
          { text: 'Cashu wallet', link: '/wallet/cashu-wallet' },
          { text: 'Provider setup', link: '/wallet/provider-setup' },
          { text: 'Receiving', link: '/wallet/receiving' },
          { text: 'Sending', link: '/wallet/sending' },
          { text: 'Error handling', link: '/wallet/error-handling' },
        ],
      },
      {
        text: 'Payments',
        items: [
          { text: 'Send and receive', link: '/payments/send-receive' },
          { text: 'Lightning', link: '/payments/lightning' },
        ],
      },
      {
        text: 'Nostr & Social',
        items: [
          { text: 'Nostr', link: '/protocols/nostr' },
          { text: 'Provider setup', link: '/protocols/provider-setup' },
          { text: 'Navigation and routes', link: '/protocols/navigation-and-routes' },
        ],
      },
      {
        text: 'Offline',
        items: [{ text: 'NFC and BitChat', link: '/offline/nfc-and-bitchat' }],
      },
      {
        text: 'Architecture',
        items: [{ text: 'Overview', link: '/architecture/overview' }],
      },
      {
        text: 'Reference',
        items: [{ text: 'Feature inventory', link: '/reference/feature-inventory' }],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/SovranBitcoin/Sovran' }],
    search: { provider: 'local' },
  },
});
