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
