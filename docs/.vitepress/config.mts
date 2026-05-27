import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Colada',
  description: 'Cashu payment flow orchestration for wallet apps',
  themeConfig: {
    nav: [{ text: 'Conventions', link: '/CONVENTIONS' }],
    sidebar: [
      {
        text: 'Docs',
        items: [{ text: 'Conventions', link: '/CONVENTIONS' }],
      },
    ],
  },
})
