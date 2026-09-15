---
layout: home

hero:
  name: Sovran
  text: A Cashu ecash wallet with Lightning and Nostr
  tagline: Payment flows, social features, and nearby token handoffs. Ecash relies on the issuing mint for backing and redemption; features vary by platform and version.
  actions:
    - theme: brand
      text: Get started
      link: /starting/start-here
    - theme: alt
      text: Feature inventory
      link: /reference/feature-inventory
    - theme: alt
      text: GitHub
      link: https://github.com/SovranBitcoin/Sovran

features:
  - title: Cashu ecash & Lightning
    details: Coco-backed proof storage and swaps, NUT-11 P2PK receive, NUT-18 payment requests, BOLT-11, LNURL-pay (LUD-06), and Lightning addresses (LUD-16).
    link: /wallet/cashu-wallet
  - title: Send & receive
    details: A state-machine-driven send/receive flow (the wallet package) — amount → mint → recipient → execute, with recipient identity enrichment and mint revalidation.
    link: /payments/send-receive
  - title: Nostr & social
    details: NIP-06 multi-account keys, NIP-17 private DMs, a Nostr feed, Vertex-ranked search, and an app-view served through the in-repo nostr package.
    link: /protocols/nostr
  - title: Nearby token handoffs
    details: Supported NFC and BitChat BLE flows can hand off ecash offline. Redemption and spendability checks need the mint; geohash Nostr rooms need network access. Device and protocol support vary.
    link: /offline/nfc-and-bitchat
  - title: AI payments
    details: Routstr fronts OpenAI-compatible LLMs and bills per request in Cashu; the wallet package mints a top-up token from your balance — no separate billing account.
    link: /reference/feature-inventory
  - title: Source workspace
    details: The Expo app uses local wallet, nostr, and copy packages through Bun workspaces. Repository code describes implementation, not current store availability or a guarantee of recovery.
    link: /architecture/overview
---
