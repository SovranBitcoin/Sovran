# Sovran

[https://sovran.money](https://sovran.money)

Sovran is an open-source Bitcoin wallet powered by ecash with Nostr capabilities. We are focused on trying to give utility to Bitcoin through our marketplace where users can buy freedom enhancing technologies such as VPNs, eSIMs and Giftcards.

<img width=300 src="https://github.com/user-attachments/assets/cb952f82-c08d-4c55-a0c1-1f513c41a619" />

## Features

- [x] Payment features include:

  - [x] Payment requests
  - [x] Lightning receiving
  - [x] Lightning sending
  - [x] Ecash receiving
  - [x] Ecash sending
  - [ ] Offline ecash sending
  - [x] Animated and static QR codes
  - [x] Backup balance with mnemonic
  - [x] Send money over Nostr
  - [x] npub.cash lightning URL
  - [ ] Custom Lightning URLs
  - [x] Easy to use QR scanner
  - [ ] Multipath Payment: Implement MPP and design an intuitive UI to pay from multiple mints
  - [ ] Mint Management: Implement better ways to help the user distribute ecash between mints
  - [ ] Unified payment addresses: Write a formal NUT for this to get community input & implement it in Sovran
  - [x] Basic NFC functionality

- [x] Marketplace features include:

  - [x] Bitrefill gift cards
  - [x] VPN using LNVPN (WireGuard)
  - [x] eSIMs in 150 countries
  - [x] Donation centre to donate to those in need

- [x] Nostr features:
  - [x] Multiple profiles via a single mnemonic
  - [x] Send direct messages to contacts
  - [x] Transactions enriched with Nostr information (profile pictures, names, etc.)

## Recovery

Our recovery process is a bit non-standard. We use a NIP05 to generate all users nostr profiles, but I didn't like the idea of every nsec having all the money attached to it. So we derive a NUT13 mnemonic from our NIP06 mnemonic which is a bit messy but it works. The reason we do this is because in all cashu wallets it expects a seed in the form of a mnemonic.

The rational was that if I chose to import my nsec into a different application my personal assumption is that it shouldn't have access to all my ecash. I understand this runs counter to NIP60, so I'm open to hearing criticism on this.

Go to `Settings > Profile` to see all your mnemonics.

Also it didn't feel right for the NIP06 and NUT13 to share the same mnemonic.

We are the only ones to my knowledge who are trying to create a single mnemonic phrase to recover _multiple_ nostr profiles which all have ecash in _multiple_ mints.
