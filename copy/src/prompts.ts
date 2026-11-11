/** Wording of the prompt that asks to trust a mint holding ecash from before 0.0.45. */
export const oldEcashClaimCopy = {
  title: "Claim your old ecash",
  /** `mint` is the mint's name or address; `amount` is null when it cannot be shown. */
  body: (claim: { mint: string; amount: string | null } | null): string => {
    if (!claim) {
      return "An earlier version of Sovran left ecash at a mint this wallet does not trust. Trust the mint to claim it.";
    }
    const ask = claim.amount
      ? `Trust ${claim.mint} to claim ${claim.amount}.`
      : `Trust ${claim.mint} to claim your ecash.`;
    return `${ask} An earlier version of Sovran received it from this mint, and the mint may keep a small fee. If you decline, it stays on this phone and you can claim it later by adding the mint.`;
  },
  review: "Review mint",
  later: "Not now",
  decline: "Don't claim",
} as const;

/** Network settings: relay edits stay on this screen until reviewed and accepted. */
export const relayEditCopy = {
  title: "Your relays",
  online: "Online",
  offline: "Offline",
  edit: "Edit relays",
  reload: "Read latest list",
  loading: "Reading your latest relay list…",
  waiting:
    "Your latest list could not be read. Connect and try again before editing.",
  pending:
    "A saved proposal is waiting. Review it against your latest list before publishing.",
  applySaved: "Use saved proposal",
  draft:
    "Changes stay on this screen until you publish. Leaving discards this draft.",
  review: "Review changes",
  reviewTitle: "Review relay changes",
  changed:
    "Your list changed elsewhere. Review the updated changes before publishing.",
  unchanged: "No changes.",
  add: "Add relay",
  url: "Relay URL",
  invalidUrl: "Enter a valid relay URL (wss://…).",
  limit: (max: number) =>
    `You can keep up to ${max} relays. Remove one to add another.`,
  defaults: "Restore defaults",
  cancel: "Cancel",
  back: "Keep editing",
  publish: "Publish relay list",
  publishing: "Publishing…",
  failed: "Could not publish. Read your latest list and review again.",
  noWrite: "Add a relay to write to, or restore defaults.",
  success: (count: number) => `Published to ${count} relays.`,
  read: "Read",
  write: "Write",
  neither: "Off",
  added: "Add",
  removed: "Remove",
  permissions: "Change permissions",
  remove: (url: string) => `Remove ${url}`,
  readFrom: (url: string) => `Read from ${url}`,
  writeTo: (url: string) => `Write to ${url}`,
} as const;
