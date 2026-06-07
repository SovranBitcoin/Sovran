export type NotificationTab = "ALL" | "MENTIONS";
export type NotificationPolicy = "RELAXED" | "MODERATE" | "STRICT";
export type NotificationReplyScope = "DIRECT" | "THREAD";

export type NotificationsInput = {
  /** The account whose notifications to load. */
  pubkey: string;
  tab?: NotificationTab;
  policy?: NotificationPolicy;
  replyScope?: NotificationReplyScope;
  since?: number;
  until?: number;
  limit?: number;
};

export function notificationsInput(
  options: NotificationsInput,
): Required<
  Pick<NotificationsInput, "pubkey" | "tab" | "policy" | "replyScope" | "limit">
> &
  Pick<NotificationsInput, "since" | "until"> {
  return {
    pubkey: options.pubkey,
    tab: options.tab ?? "ALL",
    policy: options.policy ?? "STRICT",
    replyScope: options.replyScope ?? "THREAD",
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 50,
  };
}

export const NOTIFICATION_POLICY_THRESHOLDS = {
  RELAXED: { actor: 0, viewer: 0 },
  MODERATE: { actor: 20, viewer: 60 },
  STRICT: { actor: 50, viewer: 80 },
} as const satisfies Record<
  NotificationPolicy,
  { actor: number; viewer: number }
>;
