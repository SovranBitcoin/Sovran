---
layout: home

hero:
  name: Sovran
  text: A Bitcoin wallet for Cashu, Lightning, Nostr, and offline payments
  tagline: Coco wallet state, Nostr identity, NFC and BLE-mesh handoffs, MLS group chat, and AI payments — iOS-first, built with Expo and React Native.
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
  - title: Offline payments
    details: NFC tag read/write and BitChat BLE mesh — private DMs, group chats, geohash rooms, split-bill, and Nut Drop ecash, all with no relay and no internet.
    link: /offline/nfc-and-bitchat
  - title: AI payments
    details: Routstr fronts OpenAI-compatible LLMs and bills per request in Cashu; the wallet package mints a top-up token from your balance — no separate billing account.
    link: /reference/feature-inventory
  - title: One repo, three packages
    details: The app depends on the self-contained wallet and nostr packages via the bun workspace — no inter-package publishing, no version syncing.
    link: /architecture/overview
---
