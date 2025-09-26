# Sovran

[https://sovran.money](https://sovran.money)

Sovran is an open-source Bitcoin wallet powered by ecash with Nostr capabilities. We are focused on trying to give utility to Bitcoin through our marketplace where users can buy freedom enhancing technologies such as VPNs, eSIMs and Giftcards.

<img width=300 src="https://github.com/user-attachments/assets/cb952f82-c08d-4c55-a0c1-1f513c41a619" />

## Features

- [x] Deeplinks, can receive ecash via airdrop, can send via airdrop.
- [x] (optional) pin code to unlock app
- [ ] Payment requests (needs more testing)

- [x] Lightning Receiving
  - [x] Attach note
  - [x] Websockets
  - [x] Check Status Button

- [x] Lightning Sending
  - [ ] Attach note
  - [x] Calculate Lightning fees + Mint fees
  - [x] via Pasting, Scanning, DM
  - [ ] When sending via lightning check if invoice has nostr enabled and enrich the transaction with nostr information

- [x] Ecash Receiving
  - [x] via Pasting, Scanning
  - [x] Attach note
  - [x] Unlocks tokens locked to '02' + pk

- [x] Ecash Sending
  - [x] via Copy, DM, NFC, Share QR Image, Emoji
  - [x] Lock to NPUB
  - [x] Cancel (which automatically redeems ecash)
  - [x] Attach note
  - [x] Websockets
  - [x] Check Status Button

- [ ] Offline Receive
  - [ ] via locked ecash
  - [ ] Store now and redeem later

- [x] QR Codes
  - [x] QR Code Scanner
  - [x] Animated or Static depending on context

- [x] NIP06 Mnemonic Seed for Nostr identities
- [x] NUT13 Mnemonic Seed for Ecash

- [x] Nostr DMs
  - [x] Ecash formatted nicely so you can click "Redeem"

- [x] NPCV2 Lightning URL
  - [ ] Scroll down to fetch ecash
  - [ ] Change NPC mint
  - [ ] Custom Lightning URL e.g. satoshi@npubx.cash

- [ ] Multipath Payment: Implement MPP and design an intuitive UI to pay from multiple mints
- [ ] Mint Management: Implement better ways to help the user distribute ecash between mints
- [ ] Unified payment addresses: Write a formal NUT for this to get community input & implement it in Sovran

- [x] Basic NFC functionality
  - [x] Automatic Keyset Rotation on receive/send.

- [x] Marketplace features include:
  - [ ] Bitrefill gift cards (behind dev flag)
  - [ ] VPN using LNVPN (WireGuard)
  - [ ] Donation centre to donate to those in need

- [x] Nostr features:
  - [ ] Multiple profiles via a single mnemonic (removed for now)
  - [x] Send direct messages to contacts
  - [x] Transactions enriched with Nostr information (profile pictures, names, etc.)

## Recovery

Our recovery process is a bit non-standard. We use a NIP05 to generate all users nostr profiles, but I didn't like the idea of every nsec having all the money attached to it. So we derive a NUT13 mnemonic from our NIP06 mnemonic which is a bit messy but it works. The reason we do this is because in all cashu wallets it expects a seed in the form of a mnemonic.

The rational was that if I chose to import my nsec into a different application my personal assumption is that it shouldn't have access to all my ecash. I understand this runs counter to NIP60, so I'm open to hearing criticism on this.

Go to `Settings > Profile` to see all your mnemonics.

Also it didn't feel right for the NIP06 and NUT13 to share the same mnemonic.

We are the only ones to my knowledge who are trying to create a single mnemonic phrase to recover _multiple_ nostr profiles which all have ecash in _multiple_ mints.

## TODO:

- When opening the wallet lets fetch all the mint infos and keysets just to be up-to-date.
- When I make a transaction and new proofs are created, and if they produce keysetId's I've never seen before I should automatically fetch the keyset from the mint and it to redux. I think this will ensure I always have all the keysets.
- Create better Container component that handles: Buttons, Scrolling, Keyboard Avoiding, Safe Area, works in Modals or regular screens, handles titles, handles back buttons, handles navigation.
