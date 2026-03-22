# Mint Management

Design patterns for onboarding, displaying, and managing Cashu mints — informed by the Bitcoin Design Guide's ecash best practices and reference wallet implementations.

## First mint onboarding

New users need to join a mint before they can use the wallet. The onboarding flow should explain what a mint is and help the user make an informed choice.

::: info Onboarding flow

- Explain the custodial model upfront: "A mint holds your bitcoin and issues ecash tokens. You trust the mint with your funds."
- Guide the user to their first mint via two paths: **Discover mints** (from a directory) or **Add a trusted mint** (manual URL or QR scan)
- If integrating a mint directory (e.g., bitcoinmints.com), show mint name, URL, review count, and star rating
- When connected to Nostr, filter the directory by the user's web of trust — show ratings from people they follow
- After successful connection, show a confirmation with a beta/risk reminder: "Connected to [Mint Name]. Do not store large amounts."
- Consider an explainer video or link for users unfamiliar with ecash
  :::

## Discovering mints

When the user chooses to discover mints from a directory:

::: info Mint discovery UI

- Show a "Do your own research" advisory above the mint list
- Each mint row: name, URL (truncated), review count, star rating
- Sorting options: by rating, by number of reviews, by proximity (if location data available)
- Filter by features: offline sends (NUT-11), payment requests (NUT-18), multi-currency
- Tap a mint row to see details before joining — don't auto-join on tap
  :::

## Adding a known mint

When the user already has a mint URL (from a friend, community, or printed QR):

::: info Adding a known mint

- Support three input methods: scan QR code, paste URL, type URL manually
- Validate the URL by fetching mint info (NUT-06) before adding — show the mint name, description, and version once validated
- If the URL is invalid or the mint is unreachable, show a clear error with retry option
  :::

## Mint metadata display (NUT-06)

Each mint exposes metadata via NUT-06. Display this information to help users understand and trust their mints.

### Mint details screen

::: info Mint details layout

- **Name and version**: Display prominently at the top. The version tells advanced users which mint software and release is running
- **Short description**: Show as a subtitle under the name in both the details screen and mint list rows
- **Long description**: Display in an expandable section for users who want full context
- **Contact info**: Show with appropriate icons (nostr icon for npub, email icon for email, globe for website). Hide the section entirely if no contact info is provided
- **Message of the day (MOTD)**: Display as a prominent, dismissible banner when present — mint operators use this for maintenance announcements, feature updates, or warnings
- **Supported features (NUTs)**: Translate NUT numbers into user-friendly descriptions:
  - NUT-07 → "Token state check"
  - NUT-08 → "Overpaid fee return"
  - NUT-10 → "Spending conditions"
  - NUT-11 → "Pay-to-Public-Key (offline sends)"
  - NUT-12 → "Offline ecash (DLEQ proofs)"
  - NUT-13 → "Deterministic secrets"
  - NUT-14 → "Hashed Timelock Contracts"
  - NUT-15 → "Multi-currency"
  - NUT-16 → "Animated QR codes"
  - NUT-17 → "WebSocket subscriptions"
  - NUT-18 → "Payment requests"
  - Skip NUTs 01-06 — these are mandatory for all Cashu mints
    :::

### Mint settings

::: info Mint settings actions

- **Set as default mint**: The default mint is used for auto-swapping received tokens and as the preferred mint for sending. Show a confirmation explaining this behavior after setting. Highlight the default mint with a home icon in the mint list
- **Update mint URL**: Allow editing in case the mint operator changes their domain. Validate the new URL before saving
- **Refresh mint settings**: Re-fetch NUT-06 metadata. Wallets should auto-refresh periodically, but manual refresh handles edge cases
- **Remove mint**: Destructive action — warn that any ecash held at this mint will become inaccessible if removed. Require confirmation
  :::

## Default mint and auto-swap

::: info Default mint behavior

- When the user receives ecash from a non-default mint, offer two options: "Trust this mint" or "Auto-swap to [Default Mint]"
- Auto-swap routes the ecash through Lightning (mint → melt → re-mint at default) — inform the user this involves Lightning fees
- For privacy-focused wallets, always prompt on unknown mints rather than auto-swapping silently
- Show the default mint with a distinct badge (home icon) in the mint list and mint selector
  :::

## Backup and restore

Ecash recovery requires both a seed phrase and mint list. The wallet should guide users through backing up both.

### Backup

::: info Backup guidance

- Prompt the user to back up their recovery phrase after first deposit — use the same patterns as the [Bitcoin Design Guide's backup section](https://bitcoin.design/guide/daily-spending-wallet/backup-and-recovery/landing-page/)
- The seed phrase regenerates the secrets used to mint ecash — without it, tokens cannot be recovered
- Additionally prompt the user to save their mint list — during restore, the wallet must reconnect to each mint to verify blinded messages. The mint list is not sensitive and can be stored in cloud backup
- Consider offering a downloadable/printable template for both seed phrase and mint URLs
  :::

### Restore

::: info Restore flow

- Step 1: Enter the 12-word recovery phrase
- Step 2: Add mints — the user must provide the URL for each mint they were previously connected to. The wallet cannot discover mints from the seed phrase alone
- Support adding mints by QR scan, paste, or manual entry during restore
- After providing mints, the wallet sends the regenerated blinded messages to each mint for verification — show progress per mint
- Warn that P2PK ecash tokens (NUT-11) are not derived from the seed phrase and cannot be recovered this way
  :::

## Pending tokens in history

Sent ecash tokens that haven't been redeemed should be visible in the transaction history:

::: info Pending token display

- Show pending tokens with a distinct visual state: clock icon, amber/yellow color, "Pending" label
- Distinguish from completed (green checkmark) and failed (red X) transactions
- Allow tapping a pending token to re-display the QR code / token string for re-sharing
- Provide a "Check if spent" action that queries the mint (NUT-07) to verify the token's state
- When confirmed as spent, update to "Completed" state
- For tokens pending longer than a configurable threshold (e.g., 24 hours), surface a "Reclaim" action that swaps the token back into the wallet
- Show the token's amount, mint, creation date, and memo (if any) in the expanded view
  :::
