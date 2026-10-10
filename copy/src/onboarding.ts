export const onboardingCopy = {
  slides: {
    cashu: {
      title: "Small payments on your phone",
      description:
        "Your phone holds digital cash. The issuer holds the bitcoin behind it and must be reachable to redeem it.",
    },
    nostr: {
      title: "Carry your profile with you",
      description:
        "Use your profile across compatible apps. The services carrying your posts can restrict access or go offline.",
    },
    privacy: {
      title: "Understand your privacy",
      description:
        "Digital cash limits some links between receiving and spending. Your issuer still sees payment and connection details.",
    },
    start: {
      title: "Start small",
      description:
        "Choose issuers you trust and keep backups. Use only amounts you can afford to lose.",
    },
  },
  welcome: "Welcome to Sovran",
  tagline: "Payments and conversations, together.",
  getStarted: "Get Started",
  recoveryPhrase: "I have a recovery phrase",
} as const;

export const backupIntroCopy = {
  showWords: "Show my words",
  notNow: "Not now",
  demo: "Mock Mode - practice words only. This does not back up your wallet.",
  description:
    "Write your 12 recovery words on paper, not in a screenshot or note. Keep them secret: they can give access to your wallet. Keep your mint URLs and back up imported keys separately. Recovery needs the relevant mints and supported records; words alone cannot guarantee every balance or message. Sovran cannot reset lost words.",
} as const;

export const profileRemovalCopy = {
  title: "Remove profile from this device?",
  derived: "This profile can be added again from your recovery phrase. Its local wallet records, messages and settings will be deleted. If someone may have paid it recently, open it first: a payment this device has not received yet may be lost.",
  imported: "This profile's local wallet records, messages and settings will be deleted. If someone may have paid it recently, open it first: a payment this device has not received yet may be lost. Continue to review what happens to its imported key.",
  importedTitle: "Delete the imported key?",
  importedConsequence: "The key is deleted from this device and cannot be recovered from the recovery phrase. Keep a separate backup of the imported key before removing this profile.",
  remove: "Remove profile",
  deleteKey: "Delete key and remove profile",
  cancel: "Cancel",
  refusals: {
    active: "Switch to another profile before removing this one.",
    last: "The last profile cannot be removed here. Delete Account removes everything, including your recovery phrase.",
    missing: "This profile is no longer in the profile list.",
    busy: "An account change is in progress. Try again after it finishes.",
    balance: "This profile still holds ecash. Switch to it and transfer all funds before removing it.",
    pending: "This profile has pending operations or quotes. Switch to it and resolve them before removing it.",
    unreadable: "The wallet or payment recovery records could not be safely checked without starting this profile. No further data was removed. Switch to it and resolve its wallet state first.",
    'imported-confirmation': "Confirm separately that the imported key will be deleted and cannot be recovered from your recovery phrase.",
  },
} as const;
