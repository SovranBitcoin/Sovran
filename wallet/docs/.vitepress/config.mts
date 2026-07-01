import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Colada',
  description: 'Cashu payment flow orchestration for wallet apps',
  themeConfig: {
    nav: [
      { text: 'State Machine', link: '/STATE_MACHINE' },
      { text: 'Conventions', link: '/CONVENTIONS' },
    ],
    sidebar: [
      {
        text: 'Docs',
        items: [
          { text: 'State Machine', link: '/STATE_MACHINE' },
          { text: 'Conventions', link: '/CONVENTIONS' },
        ],
      },
    ],
  },
})
