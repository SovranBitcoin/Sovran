import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: "coco-payment-ux",
    description: "Cashu payment flow orchestration for wallet apps",
    themeConfig: {
      nav: [
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'Flows', link: '/flows/cashu-send' },
        { text: 'Pipeline', link: '/pipeline/overview' },
        { text: 'Methods', link: '/methods/formatting' },
      ],

      sidebar: [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Navigation Patterns', link: '/guide/navigation-patterns' },
            { text: 'QR Display', link: '/guide/qr-display' },
            { text: 'Success Feedback', link: '/guide/success-feedback' },
            { text: 'Mint Management', link: '/guide/mint-management' },
          ],
        },
        {
          text: 'Flows',
          items: [
            { text: 'Cashu Send', link: '/flows/cashu-send' },
            { text: 'Cashu Receive', link: '/flows/cashu-receive' },
            { text: 'Quick Receive', link: '/flows/quick-receive' },
            { text: 'Lightning Send', link: '/flows/lightning-send' },
            { text: 'Lightning Receive', link: '/flows/lightning-receive' },
            { text: 'Mint Selector', link: '/flows/mint-selector' },
            { text: 'Scanning', link: '/flows/scanning' },
            { text: 'Amount Selection', link: '/flows/amount-selection' },
            { text: 'Proof Selection', link: '/flows/proof-selection' },
          ],
        },
        {
          text: 'Methods',
          items: [
            { text: 'Formatting', link: '/methods/formatting' },
            { text: 'Localization', link: '/methods/localization' },
          ],
        },
        {
          text: 'Pipeline',
          items: [
            { text: 'Overview', link: '/pipeline/overview' },
            { text: 'Normalize', link: '/pipeline/normalize' },
            { text: 'Detectors', link: '/pipeline/detectors' },
            { text: 'Parse', link: '/pipeline/parse' },
            { text: 'Annotate', link: '/pipeline/annotate' },
            { text: 'Intent', link: '/pipeline/intent' },
            { text: 'Guards', link: '/pipeline/guards' },
          ],
        },
      ],
    },
  })
)
