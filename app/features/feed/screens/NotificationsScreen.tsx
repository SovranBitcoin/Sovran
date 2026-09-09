import { describeError } from '@/shared/lib/errors';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { withAlpha } from '@/shared/lib/color';

import Icon from '@/assets/icons';
import type {
  AppNotificationsSession,
  FeedNotification,
  FeedNotificationTab,
  FeedNotificationsRequest,
  FeedNotificationsResult,
} from '@/features/feed/data/feedClient';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import {
  notificationsPageCache,
  notificationsPageKey,
} from '@/features/feed/data/notificationsCache';
import {
  notificationReasonLabel,
  notificationReplyScopeLabel,
} from '@/features/feed/lib/notificationCopy';
import { formatDate, formatRelativeUnixSeconds } from '@/shared/lib/date';
import {
  notificationListStyles,
  NotificationRowPressable,
} from '@/features/feed/components/notificationRowChrome';
import { List } from '@/shared/ui/composed/List';
import { seedNotificationFollowers } from '@/features/feed/lib/notificationFollowersSeedCache';
import {
  mergeNotificationsResult,
  notificationDedupeKey,
} from '@/features/feed/lib/notificationResults';
import {
  buildNotificationListItems,
  type NotificationListItem,
} from '@/features/feed/lib/notificationGroups';
import { seedThread } from '@/features/feed/lib/threadSeedCache';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import { MintChangesList } from '@/features/mint/components/mintChanges/MintChangesList';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  useVisualFlatListLogger,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { actionMenuPopup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

// `APP` (app announcements like the welcome card) and `MINTS` (what this
// wallet's mints changed about their NUT-06 info, served by nagg's mint
// changelog) are client-sourced tabs; neither hits the feed client.
// ALL/MENTIONS are the server-backed tabs.
type NotificationTab = FeedNotificationTab | 'APP' | 'MINTS';

const NOTIFICATION_TABS: { id: NotificationTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'MENTIONS', label: 'Mentions' },
  { id: 'MINTS', label: 'Mints' },
  { id: 'APP', label: 'App' },
];

/** Tabs that never call the feed client — they render from local sources. */
function isClientTab(tab: NotificationTab): tab is 'APP' | 'MINTS' {
  return tab === 'APP' || tab === 'MINTS';
}

const NOTIFICATIONS_PAGE_SIZE = 50;
const MAX_GROUP_AVATARS = 3;
const EMPTY_NOTIFICATIONS: readonly FeedNotification[] = [];

type LoadMode = 'initial' | 'refresh';

function notificationItemType(item: NotificationListItem): string {
  if (item.type === 'single') return item.notification.reason;
  if (item.type === 'group') return `group:${item.reason}`;
  return 'welcome';
}

/** Per-type row counts (e.g. {reaction: 3, "group:follow": 1}) for render logs. */
function notificationItemBreakdown(items: readonly NotificationListItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const type = notificationItemType(item);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/** Where an applied page-0 came from — the axis visual inconsistency hides on. */
type AppliedPageSource = 'network' | 'cache' | 'client-tab' | 'error-reset';

/**
 * One page of notifications from the feed client, with the client disposed
 * whatever happens.
 *
 * At module scope: React Compiler cannot lower a `try` with a `finally`, and an
 * inline body would cost this screen — a primary tab — its memoization.
 */
async function fetchNotificationsFromRelay({
  viewerPubkey,
  tab,
  policy,
  replyScope,
  until,
  refresh,
  signal,
}: Pick<
  FeedNotificationsRequest,
  'viewerPubkey' | 'tab' | 'policy' | 'replyScope' | 'until' | 'refresh' | 'signal'
>) {
  const client = getFeedClient();
  try {
    return await client.getNotifications({
      viewerPubkey,
      tab,
      policy,
      replyScope,
      limit: NOTIFICATIONS_PAGE_SIZE,
      until,
      refresh,
      signal,
    });
  } finally {
    client.dispose?.();
  }
}

type LoadMoreLogFields = {
  tab: NotificationTab;
  policy: FeedNotificationsRequest['policy'];
  replyScope: FeedNotificationsRequest['replyScope'];
};

/**
 * Advance the concurrent session by one page.
 *
 * At module scope, like {@link loadMoreFromRelay} and
 * {@link fetchNotificationsFromRelay}: React Compiler cannot lower a `try` with
 * a `finally`, and three of them inline cost this screen — a primary tab — its
 * memoization. `onSettled` carries the caller's `finally`.
 */
async function loadMoreFromSession({
  session,
  sequence,
  loadSequenceRef,
  hasMoreRef,
  setResult,
  logFields,
  onSettled,
}: {
  session: AppNotificationsSession;
  sequence: number;
  loadSequenceRef: React.MutableRefObject<number>;
  hasMoreRef: React.MutableRefObject<boolean>;
  setResult: React.Dispatch<React.SetStateAction<FeedNotificationsResult | null>>;
  logFields: LoadMoreLogFields;
  onSettled: () => void;
}): Promise<void> {
  try {
    const page = await session.loadMore();
    if (sequence !== loadSequenceRef.current) return;
    hasMoreRef.current = session.hasMore();
    setResult(page);
    feedLog.info('feed.notifications.ui.load_more', {
      ...logFields,
      transport: 'session',
      pageResults: page.notifications.length,
      pending: session.pendingCount(),
      hasMore: hasMoreRef.current,
    });
  } catch (error) {
    if (sequence !== loadSequenceRef.current) return;
    const message = error instanceof Error ? error.message : String(error);
    feedLog.warn('feed.notifications.load_more_failed', {
      ...logFields,
      transport: 'session',
      message,
    });
  } finally {
    onSettled();
  }
}

/** Advance the relay-backed list by one page, deduping against `seenKeysRef`. */
async function loadMoreFromRelay({
  fetchPage,
  signal,
  cursor,
  sequence,
  loadSequenceRef,
  hasMoreRef,
  paginationUntilRef,
  seenKeysRef,
  setResult,
  logFields,
  onSettled,
}: {
  fetchPage: (args: {
    signal: AbortSignal;
    until?: number;
    refresh?: boolean;
  }) => Promise<FeedNotificationsResult | null>;
  signal: AbortSignal;
  cursor: number;
  sequence: number;
  loadSequenceRef: React.MutableRefObject<number>;
  hasMoreRef: React.MutableRefObject<boolean>;
  paginationUntilRef: React.MutableRefObject<number>;
  seenKeysRef: React.MutableRefObject<Set<string>>;
  setResult: React.Dispatch<React.SetStateAction<FeedNotificationsResult | null>>;
  logFields: LoadMoreLogFields;
  onSettled: () => void;
}): Promise<void> {
  try {
    const page = await fetchPage({ signal, until: cursor, refresh: false });
    if (!page || signal.aborted || sequence !== loadSequenceRef.current) return;

    const newKeys = page.notifications
      .map(notificationDedupeKey)
      .filter((key) => !seenKeysRef.current.has(key));
    const advanced = page.paginationUntil > 0 && page.paginationUntil < cursor;
    // Stop only when a page adds nothing new or the cursor can't advance —
    // grouping makes the raw item count an unreliable "has more" signal.
    hasMoreRef.current = newKeys.length > 0 && advanced;
    if (advanced) paginationUntilRef.current = page.paginationUntil;
    if (newKeys.length > 0) {
      newKeys.forEach((key) => seenKeysRef.current.add(key));
      setResult((previous) => mergeNotificationsResult(previous, page));
    }
    feedLog.info('feed.notifications.ui.load_more', {
      ...logFields,
      cursor,
      pageResults: page.notifications.length,
      newItems: newKeys.length,
      advanced,
      hasMore: hasMoreRef.current,
    });
  } catch (error) {
    if (signal.aborted || sequence !== loadSequenceRef.current) return;
    const message = error instanceof Error ? error.message : String(error);
    feedLog.warn('feed.notifications.load_more_failed', { ...logFields, message });
  } finally {
    onSettled();
  }
}

export function NotificationsScreen() {
  useLifecycleLogger('NotificationsScreen', feedLog);

  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const policy = useNotificationPolicyStore((state) => state.policy);
  const replyScope = useNotificationPolicyStore((state) => state.replyScope);
  const setReplyScope = useNotificationPolicyStore((state) => state.setReplyScope);
  const [activeTab, setActiveTab] = useState<NotificationTab>('ALL');
  const [result, setResult] = useState<FeedNotificationsResult | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const paginationUntilRef = useRef(0);
  // Group identities already shown, so load-more can stop when a page brings
  // nothing new — more reliable than the server's (conservative) hasNextPage,
  // which under-reports once grouping collapses a page below the page size.
  const seenKeysRef = useRef<Set<string>>(new Set());
  const [foreground, surface, separator, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
    'surface-tertiary',
  ] as const);
  const notificationsVisualScope = useMemo(
    () => `feed.notifications.${activeTab.toLowerCase()}.list`,
    [activeTab]
  );

  // The unified three-source session (nagg + Primal + relays, concurrent).
  // Owns cross-source dedupe, per-source cursors, and the pooled-new-rows
  // no-shift contract; the refs here only manage its lifecycle.
  const sessionRef = useRef<AppNotificationsSession | null>(null);
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const closeSession = useCallback(() => {
    sessionUnsubRef.current?.();
    sessionUnsubRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
  }, []);

  // Own recent event ids power the relay floor's #e/#q backstop and flip its
  // reply/engagement classification fail-open → fail-closed.
  const ownContentById = useOwnContentStore((s) => s.byId);
  const ownEventIds = useMemo(
    () =>
      Object.values(ownContentById)
        .sort((a, b) => b.event.created_at - a.event.created_at)
        .slice(0, 200)
        .map((entry) => entry.event.id),
    [ownContentById]
  );

  const fetchNotificationsPage = useCallback(
    async ({
      signal,
      until,
      refresh,
    }: {
      signal: AbortSignal;
      until?: number;
      refresh?: boolean;
    }) => {
      // Client-only tabs (synthetic announcements, mint changelog) never fetch.
      if (!viewerPubkey || isClientTab(activeTab)) return null;
      return fetchNotificationsFromRelay({
        viewerPubkey,
        tab: activeTab,
        policy,
        replyScope,
        until,
        refresh,
        signal,
      });
    },
    [activeTab, policy, replyScope, viewerPubkey]
  );

  const applyFirstPage = useCallback(
    (page: FeedNotificationsResult | null, source: AppliedPageSource) => {
      paginationUntilRef.current = page?.paginationUntil ?? 0;
      seenKeysRef.current = new Set((page?.notifications ?? []).map(notificationDedupeKey));
      // Optimistic: as long as there's a cursor, try to page. load-more stops as
      // soon as a fetch brings no genuinely-new items.
      hasMoreRef.current = !!page && page.paginationUntil > 0;
      feedLog.info('feed.notifications.ui.applied', {
        source,
        tab: activeTab,
        policy,
        replyScope,
        notifications: page?.notifications.length ?? 0,
        hasPage: !!page,
        paginationUntil: page?.paginationUntil ?? 0,
      });
      setResult(page);
    },
    [activeTab, policy, replyScope]
  );

  const loadFirstPage = useCallback(
    (signal: AbortSignal, mode: LoadMode) => {
      const sequence = ++loadSequenceRef.current;
      // No viewer, or a client-only tab → nothing to fetch; the synthetic items
      // (welcome card) and the mint changelog render without a server round-trip.
      if (!viewerPubkey || isClientTab(activeTab)) {
        feedLog.info('feed.notifications.ui.load', {
          mode,
          tab: activeTab,
          policy,
          replyScope,
          viewerReady: !!viewerPubkey,
          clientTab: isClientTab(activeTab),
        });
        applyFirstPage(null, 'client-tab');
        setErrorMessage(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        return;
      }

      const cacheKey = notificationsPageKey({ viewerPubkey, tab: activeTab, policy, replyScope });

      // Warm navigation (key touched earlier this session): paint the cached
      // page instantly and revalidate. Cold start (first focus this session):
      // show loading, never a stale first paint.
      const coldStart = notificationsPageCache.isColdStart(cacheKey);
      const cached =
        mode === 'initial' && !coldStart ? notificationsPageCache.getEntry(cacheKey) : undefined;
      feedLog.info('feed.notifications.ui.load', {
        mode,
        tab: activeTab,
        policy,
        replyScope,
        viewerReady: true,
        clientTab: false,
        coldStart,
        cacheHit: !!cached,
      });
      let paintedFromCache = false;
      if (mode === 'initial') {
        if (cached) {
          applyFirstPage(cached.data, 'cache');
          setIsInitialLoading(false);
          paintedFromCache = true;
        } else {
          setResult(null);
          setIsInitialLoading(true);
        }
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      // Unified session first: all three sources concurrently, one merged page.
      // Falls back to the one-shot waterfall when the client/layer can't serve
      // a session (legacy transport, no facade layer).
      closeSession();
      const sessionClient = getFeedClient();
      const session =
        sessionClient.openNotificationsSession?.({
          viewerPubkey,
          tab: activeTab,
          policy,
          replyScope,
          limit: NOTIFICATIONS_PAGE_SIZE,
          refresh: mode === 'refresh',
          ownEventIds,
          signal,
        }) ?? null;
      sessionRef.current = session;
      sessionClient.dispose?.();

      // Only an explicit pull-to-refresh forces nagg to revalidate. An initial
      // focus reads the shared response cache (which auto-revalidates a stale
      // entry in the background), so opening the screen no longer pays the full
      // recompute cost on every mount.
      const firstLoad = session
        ? session.firstPage()
        : fetchNotificationsPage({ signal, refresh: mode === 'refresh' });
      void firstLoad
        .then((page) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          applyFirstPage(page, 'network');
          if (page) notificationsPageCache.setEntry(cacheKey, page, { viewerKey: viewerPubkey });
          notificationsPageCache.markTouched(cacheKey);
          if (!session) return;
          hasMoreRef.current = session.hasMore();
          // In-place updates only (count bumps, shape/profile upgrades, pool
          // count changes): row ids are stable, so the list updates without
          // remounting or shifting; new rows wait for the next load-more.
          sessionUnsubRef.current = session.subscribe(() => {
            if (sequence !== loadSequenceRef.current) return;
            const snap = session.snapshot();
            feedLog.debug('feed.notifications.session.update', {
              tab: activeTab,
              rows: snap.notifications.length,
              pending: session.pendingCount(),
            });
            hasMoreRef.current = session.hasMore();
            setResult(snap);
          });
        })
        .catch((error) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          feedLog.warn('feed.notifications.load_failed', {
            mode,
            tab: activeTab,
            policy,
            replyScope,
            paintedFromCache,
            message,
          });
          setErrorMessage(describeError(error, 'nagg').text);
          // Keep the warm-painted page on a transient failure.
          if (mode === 'initial' && !paintedFromCache) applyFirstPage(null, 'error-reset');
        })
        .finally(() => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          if (mode === 'initial') setIsInitialLoading(false);
          else setIsRefreshing(false);
        });
    },
    [
      applyFirstPage,
      closeSession,
      fetchNotificationsPage,
      ownEventIds,
      viewerPubkey,
      activeTab,
      policy,
      replyScope,
    ]
  );

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadFirstPage(controller.signal, 'initial');
      return () => {
        controller.abort();
        refreshControllerRef.current?.abort();
        refreshControllerRef.current = null;
        loadSequenceRef.current += 1;
        closeSession();
      };
    }, [loadFirstPage, closeSession])
  );

  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    loadFirstPage(controller.signal, 'refresh');
  }, [isRefreshing, loadFirstPage]);

  const loadMoreNotifications = useCallback(async () => {
    // Session path: the session owns cursors/dedupe and the pooled-row reveal;
    // this is the sanctioned page boundary where new rows may appear.
    const session = sessionRef.current;
    if (session) {
      if (loadingMoreRef.current || isInitialLoading || isRefreshing || !session.hasMore()) return;
      const sequence = loadSequenceRef.current;
      loadingMoreRef.current = true;
      setIsLoadingMore(true);
      await loadMoreFromSession({
        session,
        sequence,
        loadSequenceRef,
        hasMoreRef,
        setResult,
        logFields: { tab: activeTab, policy, replyScope },
        onSettled: () => {
          loadingMoreRef.current = false;
          setIsLoadingMore(false);
        },
      });
      return;
    }

    if (
      loadingMoreRef.current ||
      isInitialLoading ||
      isRefreshing ||
      !viewerPubkey ||
      !hasMoreRef.current ||
      paginationUntilRef.current <= 0
    ) {
      return;
    }

    const sequence = loadSequenceRef.current;
    const cursor = paginationUntilRef.current;
    const controller = new AbortController();
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    await loadMoreFromRelay({
      fetchPage: fetchNotificationsPage,
      signal: controller.signal,
      cursor,
      sequence,
      loadSequenceRef,
      hasMoreRef,
      paginationUntilRef,
      seenKeysRef,
      setResult,
      logFields: { tab: activeTab, policy, replyScope },
      onSettled: () => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      },
    });
  }, [
    activeTab,
    fetchNotificationsPage,
    isInitialLoading,
    isRefreshing,
    policy,
    replyScope,
    viewerPubkey,
  ]);

  const selectTab = useCallback(
    (tab: NotificationTab) => {
      if (tab === activeTab) return;
      feedLog.info('feed.notifications.ui.tab_selected', {
        from: activeTab,
        to: tab,
        policy,
        replyScope,
      });
      paginationUntilRef.current = 0;
      hasMoreRef.current = false;
      seenKeysRef.current = new Set();
      setResult(null);
      setErrorMessage(null);
      setIsLoadingMore(false);
      setIsInitialLoading(true);
      setActiveTab(tab);
    },
    [activeTab, policy, replyScope]
  );

  // Direct/Thread reply-scope picker for the Mentions tab. Mirrors the Following
  // feed tab: the Mentions pill shows a chevron and opens this popup when active.
  const openReplyScopeMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Mentions',
      buttons: (['DIRECT', 'THREAD'] as const).map((scope) => ({
        text: notificationReplyScopeLabel(scope),
        variant: replyScope === scope ? 'primary' : undefined,
        onPress: (close) => {
          close();
          setReplyScope(scope);
        },
      })),
    });
  }, [replyScope, setReplyScope]);

  // Tapping Mentions when it's already active opens the scope popup (like
  // Following); otherwise it just switches tabs.
  const handleNotificationTabPress = useCallback(
    (tab: NotificationTab) => {
      if (tab === 'MENTIONS' && activeTab === 'MENTIONS') {
        openReplyScopeMenu();
        return;
      }
      selectTab(tab);
    },
    [activeTab, openReplyScopeMenu, selectTab]
  );

  const threadContext = useMemo(
    () => ({
      profiles: result?.profilesMap ?? new Map(),
      metrics: result?.metricsMap ?? new Map(),
      quotedEvents: result?.quotedEventsMap ?? new Map(),
    }),
    [result]
  );

  const openNotification = useCallback(
    (notification: FeedNotification) => {
      if (notification.reason === 'follow') {
        router.push({
          pathname: '/(user-flow)/profile',
          params: { pubkey: notification.event.pubkey },
        });
        return;
      }
      const openEventId = notificationOpenEventId(notification);
      const allEvents = new Map([[notification.event.id, notification.event]]);
      if (notification.targetEvent)
        allEvents.set(notification.targetEvent.id, notification.targetEvent);
      seedThread(openEventId, {
        allEvents,
        profiles: threadContext.profiles,
        metrics: threadContext.metrics,
        quotedEvents: threadContext.quotedEvents,
      });
      router.push({
        pathname: '/(user-flow)/thread',
        params: { eventId: openEventId },
      });
    },
    [threadContext]
  );

  const openFollowGroup = useCallback(
    (notifications: FeedNotification[]) => {
      const seedId = seedNotificationFollowers({ notifications, result });
      router.push({
        pathname: '/(drawer)/(tabs)/notifications/followers',
        params: { seedId },
      });
    },
    [result]
  );

  const seedCreatedAt = useWalletLifecycleStore((s) => s.seedCreatedAt);
  const termsDate = useSettingsStore((s) => s.termsAccepted?.date ?? null);

  const rawNotifications = result?.notifications ?? EMPTY_NOTIFICATIONS;

  // A like/repost/zap is always engagement on one of OUR posts, so its target's
  // content is in the own-content cache (notes we authored, keyed by id). nagg
  // bundles the full `targetEvent`; the relay/cache tiers only carry
  // `targetEventId`, leaving no preview. Resolve the missing target from local
  // own-content so the post preview renders regardless of serving tier — its
  // author is us, so no profile refetch is needed (see viewerPubkey below).
  // (ownContentById is subscribed above, next to the session refs, where the
  // same store also feeds the relay ownEventIds backstop.)
  const notifications = useMemo(() => {
    let changed = false;
    const hydrated = rawNotifications.map((n) => {
      if (n.targetEvent) return n;
      if (n.reason !== 'reaction' && n.reason !== 'repost' && n.reason !== 'zap') return n;
      const targetId = n.targetEventId;
      if (!targetId) return n;
      const entry = ownContentById[targetId];
      if (!entry) return n;
      changed = true;
      return { ...n, targetEvent: entry.event };
    });
    return changed ? hydrated : rawNotifications;
  }, [rawNotifications, ownContentById]);

  // The serving tier's `profilesMap` is empty on the relay/cache path (only nagg
  // bundles notification author profiles), leaving rows with a truncated-pubkey
  // name + fallback avatar. Warm + read the shared metadata cache (filled by the
  // facade getProfiles: Primal user_infos → relay kind-0) for every actor and
  // merge it in as a fallback, so names/avatars resolve regardless of tier.
  const actorPubkeys = useMemo(() => {
    const set = new Set<string>();
    // Our own profile authors every like/repost/zap target preview — warm it too
    // so the contained post shows our name + avatar, not a truncated pubkey.
    if (viewerPubkey) set.add(viewerPubkey);
    for (const n of notifications) {
      if (n.event?.pubkey) set.add(n.event.pubkey);
      for (const actor of n.sampleActors ?? []) if (actor.pubkey) set.add(actor.pubkey);
    }
    return [...set];
  }, [notifications, viewerPubkey]);
  const { metadata: cachedProfiles } = useNostrProfileMetadataMany(actorPubkeys);

  const resultForRows = useMemo<FeedNotificationsResult | null>(() => {
    if (!result || cachedProfiles.size === 0) return result;
    const profilesMap = new Map(result.profilesMap);
    for (const [pk, meta] of cachedProfiles) {
      const existing = profilesMap.get(pk);
      // Fill a missing actor, or upgrade a name-only tier entry that lacks a picture.
      if (existing && existing.picture) continue;
      const name = meta.displayName || meta.name || existing?.name;
      const picture = meta.picture ?? existing?.picture;
      if (!name && !picture) continue;
      profilesMap.set(pk, { name: name ?? '', ...(picture ? { picture } : {}) });
    }
    return { ...result, profilesMap };
  }, [result, cachedProfiles]);

  const notificationItems = useMemo<NotificationListItem[]>(() => {
    // The App tab is purely app announcements — the welcome card lives here, not
    // mixed into the real notifications on All.
    if (activeTab === 'APP') {
      return [{ type: 'welcome', id: 'welcome-sovran', installDate: seedCreatedAt, termsDate }];
    }
    return buildNotificationListItems(notifications);
  }, [notifications, activeTab, seedCreatedAt, termsDate]);
  const visualPhase = isInitialLoading ? 'initial-loading' : isRefreshing ? 'refreshing' : 'ready';
  const { onListLayout, onListContentSizeChange, onListScroll, onListViewableItemsChanged } =
    useVisualFlatListLogger<NotificationListItem>({
      scope: notificationsVisualScope,
      surface: 'notifications',
      component: 'NotificationsFlatList',
      phase: visualPhase,
      extra: () => ({
        tab: activeTab,
        replyScope,
        items: notificationItems.length,
        rows: notificationItems.length,
        loadingMore: isLoadingMore,
      }),
      remeasureExtra: () => ({
        tab: activeTab,
        items: notificationItems.length,
        loadingMore: isLoadingMore,
      }),
      getItemKey: (item) => `notification:${item.id}`,
      getItemContext: (item) => ({
        itemType: notificationItemType(item),
        rowLabel: item.type,
      }),
    });

  // Render boundary for notifications: result rows → rendered list items under
  // the active filter options, plus a per-type breakdown of what's on screen.
  // Cross-check with feed.notifications.fetch.done (data layer, carries the
  // serving tier) and feed.notifications.ui.applied (page source) to localize
  // an inconsistent or empty notifications screen.
  useEffect(() => {
    feedLog.info('feed.notifications.ui.render', {
      tab: activeTab,
      policy,
      replyScope,
      phase: visualPhase,
      notifications: notifications.length,
      items: notificationItems.length,
      itemTypes: notificationItemBreakdown(notificationItems),
      empty: notificationItems.length === 0,
      error: !!errorMessage,
    });
  }, [
    notifications.length,
    notificationItems,
    activeTab,
    policy,
    replyScope,
    visualPhase,
    errorMessage,
  ]);

  return (
    <Screen name="NotificationsScreen" scroll="custom" bgColor={surface}>
      <Log name="NotificationsContent" style={notificationListStyles.root}>
        <VisualLayoutProbe
          scope={notificationsVisualScope}
          surface="notifications"
          component="NotificationsTabs"
          itemKey="tabs"
          itemType="tabs"
          extra={{ tab: activeTab, replyScope }}>
          <View
            style={[
              styles.filtersRow,
              {
                backgroundColor: surface,
                borderBottomColor: separator,
              },
            ]}>
            <View style={styles.filtersContent}>
              {NOTIFICATION_TABS.map((tab) => (
                <FeedTabButton
                  key={tab.id}
                  label={tab.label}
                  active={activeTab === tab.id}
                  showChevron={tab.id === 'MENTIONS' && activeTab === 'MENTIONS'}
                  onPress={() => handleNotificationTabPress(tab.id)}
                />
              ))}
            </View>
          </View>
        </VisualLayoutProbe>
        {activeTab === 'MINTS' ? (
          // Mint changes have their own source, refresh and row shapes — the
          // notifications list below stays untouched.
          <MintChangesList />
        ) : (
          <List
            screen
            data={notificationItems}
            keyExtractor={(item) => item.id}
            // Heterogeneous rows (welcome/group/single) — without this
            // FlashList v2 recycles one variant's component into another's
            // slot (recycling corruption). Module helper also feeds render
            // logs, so pools split per notification reason.
            getItemType={notificationItemType}
            contentContainerStyle={[
              notificationListStyles.listContent,
              notificationItems.length === 0 && notificationListStyles.emptyListContent,
            ]}
            contentInsetAdjustmentBehavior="never"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={foreground}
              />
            }
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: separator }]} />
            )}
            ListEmptyComponent={
              isInitialLoading ? (
                <VisualLayoutProbe
                  scope={notificationsVisualScope}
                  surface="notifications"
                  component="NotificationsInitialSpinner"
                  itemKey="empty:initial-spinner"
                  itemType="spinner"
                  extra={{ tab: activeTab, phase: visualPhase }}>
                  <Spinner
                    size={22}
                    color={withAlpha(foreground, 0.65)}
                    style={notificationListStyles.loader}
                  />
                </VisualLayoutProbe>
              ) : (
                <VisualLayoutProbe
                  scope={notificationsVisualScope}
                  surface="notifications"
                  component="NotificationsEmptyState"
                  itemKey={errorMessage ? 'empty:error' : 'empty:no-results'}
                  itemType={errorMessage ? 'error' : 'empty'}
                  extra={{ tab: activeTab, viewerReady: !!viewerPubkey }}>
                  <EmptyNotifications
                    viewerReady={!!viewerPubkey}
                    errorMessage={errorMessage}
                    foreground={foreground}
                    muted={muted}
                  />
                </VisualLayoutProbe>
              )
            }
            ListFooterComponent={
              // Only when there's content — never stacked on the empty-state spinner.
              isLoadingMore && notificationItems.length > 0 ? (
                <VisualLayoutProbe
                  scope={notificationsVisualScope}
                  surface="notifications"
                  component="NotificationsPaginationSpinner"
                  itemKey="footer:pagination-spinner"
                  itemType="spinner"
                  extra={{ tab: activeTab, items: notificationItems.length }}>
                  <Spinner
                    size={18}
                    color={withAlpha(foreground, 0.65)}
                    style={notificationListStyles.footerSpinner}
                  />
                </VisualLayoutProbe>
              ) : null
            }
            // Load-more reveals pooled rows into their true chronological slots
            // (possibly above the viewport); FlashList v2's default
            // maintainVisibleContentPosition keeps the visible window anchored.
            onLayout={onListLayout}
            onContentSizeChange={onListContentSizeChange}
            onEndReached={loadMoreNotifications}
            onEndReachedThreshold={0.4}
            onScroll={onListScroll}
            scrollEventThrottle={250}
            viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
            onViewableItemsChanged={onListViewableItemsChanged}
            renderItem={({ item, index }) => (
              <VisualLayoutProbe
                scope={notificationsVisualScope}
                surface="notifications"
                component="NotificationListRow"
                itemKey={`notification:${item.id}`}
                itemType={item.type}
                index={index}
                extra={{ tab: activeTab, phase: visualPhase }}>
                <NotificationListRow
                  item={item}
                  result={resultForRows}
                  foreground={foreground}
                  surface={surface}
                  muted={muted}
                  pressedBackground={withAlpha(surfaceTertiary, 0.45)}
                  onPressNotification={openNotification}
                  onPressFollowGroup={openFollowGroup}
                />
              </VisualLayoutProbe>
            )}
          />
        )}
      </Log>
    </Screen>
  );
}

function NotificationListRow({
  item,
  result,
  foreground,
  surface,
  muted,
  pressedBackground,
  onPressNotification,
  onPressFollowGroup,
}: {
  item: NotificationListItem;
  result: FeedNotificationsResult | null;
  foreground: string;
  surface: string;
  muted: string;
  pressedBackground: string;
  onPressNotification: (notification: FeedNotification) => void;
  onPressFollowGroup: (notifications: FeedNotification[]) => void;
}) {
  if (item.type === 'welcome') {
    return (
      <WelcomeNotificationRow
        installDate={item.installDate}
        termsDate={item.termsDate}
        foreground={foreground}
        muted={muted}
      />
    );
  }
  if (item.type === 'group') {
    return (
      <NotificationGroupRow
        item={item}
        result={result}
        foreground={foreground}
        surface={surface}
        muted={muted}
        pressedBackground={pressedBackground}
        onPress={() =>
          item.reason === 'follow'
            ? onPressFollowGroup(item.notifications)
            : onPressNotification(item.notifications[0]!)
        }
      />
    );
  }
  return (
    <NotificationRow
      notification={item.notification}
      result={result}
      foreground={foreground}
      muted={muted}
      pressedBackground={pressedBackground}
      onPress={() => onPressNotification(item.notification)}
    />
  );
}

function WelcomeNotificationRow({
  installDate,
  termsDate,
  foreground,
  muted,
}: {
  installDate: number | null;
  termsDate: string | null;
  foreground: string;
  muted: string;
}) {
  const accent = useThemeColor('accent');
  const dateBits: string[] = [];
  if (typeof installDate === 'number' && installDate > 0) {
    dateBits.push(`Joined ${formatDate(installDate, 'short-date')}`);
  }
  if (termsDate) {
    const parsed = Date.parse(termsDate);
    if (!Number.isNaN(parsed)) {
      dateBits.push(`Terms agreed ${formatDate(parsed, 'short-date')}`);
    }
  }
  return (
    <View style={notificationListStyles.row}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <View style={[styles.welcomeGlyph, { backgroundColor: withAlpha(accent, 0.13) }]}>
            <Icon name="iconamoon:heart-fill" size={22} color={accent} />
          </View>
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title="Thanks for downloading Sovran"
              timestamp=""
              foreground={foreground}
              muted={muted}
            />
            {dateBits.length > 0 ? (
              <Text size={14} style={{ color: muted }}>
                {dateBits.join('  ·  ')}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      </VStack>
    </View>
  );
}

function NotificationRow({
  notification,
  result,
  foreground,
  muted,
  pressedBackground,
  onPress,
}: {
  notification: FeedNotification;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
  pressedBackground: string;
  onPress: () => void;
}) {
  const profile = result?.profilesMap.get(notification.event.pubkey);
  const name = profile?.name || `${notification.event.pubkey.slice(0, 8)}...`;
  const title = notificationTitle(name, notification.reason, !!notification.targetEvent);
  const tone = notificationTone(notification.reason);
  const timestamp = notificationEventTimestamp(notification);

  return (
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={onPress}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason={notification.reason} color={tone} />
          <View>
            <Avatar
              state={profile?.picture ? 'image' : 'fallback'}
              picture={profile?.picture}
              name={name}
              seed={notification.event.pubkey}
              size={42}
            />
          </View>
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title={title}
              timestamp={timestamp}
              foreground={foreground}
              muted={muted}
              badge={<TierBadge eventId={notification.event.id} />}
            />
          </VStack>
        </HStack>
        <NotificationBody
          notification={notification}
          result={result}
          foreground={foreground}
          muted={muted}
        />
      </VStack>
    </NotificationRowPressable>
  );
}

function NotificationGroupRow({
  item,
  result,
  foreground,
  surface,
  muted,
  pressedBackground,
  onPress,
}: {
  item: Extract<NotificationListItem, { type: 'group' }>;
  result: FeedNotificationsResult | null;
  foreground: string;
  surface: string;
  muted: string;
  pressedBackground: string;
  onPress: () => void;
}) {
  const tone = notificationTone(item.reason);
  const names = item.notifications.map((notification) => notificationName(notification, result));
  const title = groupedNotificationTitle(names, item.total, item.reason, item.totalCapped);
  const previewEvent =
    item.reason === 'repost' || item.reason === 'reaction' || item.reason === 'zap'
      ? item.notifications[0]?.targetEvent
      : undefined;
  const timestamp = notificationGroupTimestamp(item.notifications);

  return (
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={onPress}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason={item.reason} color={tone} />
          <AvatarCluster notifications={item.notifications} result={result} borderColor={surface} />
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title={title}
              timestamp={timestamp}
              foreground={foreground}
              muted={muted}
              badge={
                item.notifications[0] ? (
                  <TierBadge eventId={item.notifications[0].event.id} />
                ) : undefined
              }
            />
          </VStack>
        </HStack>
        {previewEvent ? (
          <View style={styles.bodyContent}>
            <NotificationReferencedPost
              event={previewEvent}
              result={result}
              foreground={foreground}
              muted={muted}
              contained
            />
          </View>
        ) : null}
      </VStack>
    </NotificationRowPressable>
  );
}

function AvatarCluster({
  notifications,
  result,
  borderColor,
}: {
  notifications: FeedNotification[];
  result: FeedNotificationsResult | null;
  borderColor: string;
}) {
  const preview = notifications.slice(0, MAX_GROUP_AVATARS);
  return (
    <View style={[styles.avatarCluster, { width: 46 + Math.max(0, preview.length - 1) * 16 }]}>
      {preview.map((notification, index) => {
        const profile = result?.profilesMap.get(notification.event.pubkey);
        const name = profile?.name || `${notification.event.pubkey.slice(0, 8)}...`;
        return (
          <View
            key={notification.event.id}
            style={[
              styles.clusterAvatar,
              {
                backgroundColor: borderColor,
                borderColor,
                left: index * 16,
              },
            ]}>
            <Avatar
              state={profile?.picture ? 'image' : 'fallback'}
              picture={profile?.picture}
              name={name}
              seed={notification.event.pubkey}
              size={42}
            />
          </View>
        );
      })}
    </View>
  );
}

function NotificationReasonIcon({ reason, color }: { reason: string; color: string }) {
  return (
    <View style={[styles.reasonIcon, { backgroundColor: withAlpha(color, 0.13) }]}>
      <Icon name={notificationIcon(reason)} size={17} color={color} />
    </View>
  );
}

function NotificationTitleLine({
  title,
  timestamp,
  foreground,
  muted,
  badge,
}: {
  title: string;
  timestamp: string;
  foreground: string;
  muted: string;
  /** Dev-only data-source chip (n/c/r), rendered after the timestamp. */
  badge?: React.ReactNode;
}) {
  return (
    <HStack
      align="flex-start"
      justify="space-between"
      gap={8}
      style={notificationListStyles.titleLine}>
      <Text
        numberOfLines={2}
        size={16}
        style={[notificationListStyles.titleText, { color: foreground }]}>
        {title}
      </Text>
      <HStack align="center" gap={4}>
        {timestamp ? (
          <Text
            numberOfLines={1}
            size={13}
            style={[notificationListStyles.timestampText, { color: muted }]}>
            {timestamp}
          </Text>
        ) : null}
        {badge}
      </HStack>
    </HStack>
  );
}

function NotificationBody({
  notification,
  result,
  foreground,
  muted,
}: {
  notification: FeedNotification;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
}) {
  const previewEvent = notificationPreviewEvent(notification);
  // The optional chains are resolved before the ternary: React Compiler cannot
  // lower an optional member access used as a ternary's test.
  const previewEventId = previewEvent?.id;
  const targetEventId = notification.targetEvent?.id;
  const targetEvent = previewEventId === targetEventId ? undefined : notification.targetEvent;

  if (!previewEvent) return null;

  if (
    notification.reason === 'reply' ||
    notification.reason === 'quote' ||
    notification.reason === 'mention'
  ) {
    return (
      <VStack gap={8} style={styles.bodyContent}>
        <NotificationEventText event={previewEvent} foreground={foreground} muted={muted} />
        {targetEvent ? (
          <NotificationReferencedPost
            event={targetEvent}
            result={result}
            foreground={foreground}
            muted={muted}
            showAuthorAvatar
          />
        ) : null}
      </VStack>
    );
  }

  return (
    <View style={styles.bodyContent}>
      <NotificationReferencedPost
        event={previewEvent}
        result={result}
        foreground={foreground}
        muted={muted}
        contained={
          notification.reason === 'reaction' ||
          notification.reason === 'zap' ||
          notification.reason === 'repost'
        }
      />
    </View>
  );
}

function NotificationEventText({
  event,
  foreground,
  muted,
}: {
  event: FeedEvent;
  foreground: string;
  muted: string;
}) {
  const content = event.content.trim();
  return (
    <Text numberOfLines={4} size={15} style={{ color: content ? foreground : muted }}>
      {content || 'Post unavailable'}
    </Text>
  );
}

function NotificationReferencedPost({
  event,
  result,
  foreground,
  muted,
  showAuthorAvatar = false,
  contained = false,
}: {
  event: FeedEvent;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
  showAuthorAvatar?: boolean;
  contained?: boolean;
}) {
  const profile = result?.profilesMap.get(event.pubkey);
  const name = profile?.name || `${event.pubkey.slice(0, 8)}...`;
  const content = event.content.trim();
  const isContained = showAuthorAvatar || contained;
  const targetPostBackground = isContained ? withAlpha(foreground, 0.055) : 'transparent';

  return (
    <VStack
      gap={3}
      style={[
        styles.referencedPost,
        isContained && styles.referencedPostContained,
        isContained && {
          backgroundColor: targetPostBackground,
          borderColor: withAlpha(foreground, 0.08),
        },
      ]}>
      <HStack align="center" gap={6}>
        {showAuthorAvatar ? (
          <Avatar
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            name={name}
            seed={event.pubkey}
            size={18}
          />
        ) : null}
        <Text bold numberOfLines={1} size={13} style={{ color: withAlpha(foreground, 0.72) }}>
          {name}
        </Text>
      </HStack>
      <Text numberOfLines={3} size={14} style={{ color: content ? foreground : muted }}>
        {content || 'Post unavailable'}
      </Text>
    </VStack>
  );
}

function notificationName(
  notification: FeedNotification,
  result: FeedNotificationsResult | null
): string {
  return (
    result?.profilesMap.get(notification.event.pubkey)?.name ||
    `${notification.event.pubkey.slice(0, 8)}...`
  );
}

function notificationEventTimestamp(notification: FeedNotification): string {
  return formatRelativeUnixSeconds(notification.event.created_at);
}

function notificationGroupTimestamp(notifications: readonly FeedNotification[]): string {
  const latest = notifications.reduce(
    (max, notification) => Math.max(max, notification.event.created_at),
    0
  );
  return formatRelativeUnixSeconds(latest);
}

// For a like/repost/zap, tapping the row should open the POST that was engaged
// with — not the reaction/repost/zap event. nagg bundles the full `targetEvent`,
// but the relay/cache tiers only carry `targetEventId` (the post isn't fetched),
// so resolve by id and let the thread screen load it. Falls back to the
// notification's own event for replies/mentions (where the event IS the post).
function notificationOpenEventId(notification: FeedNotification): string {
  if (
    notification.reason === 'reaction' ||
    notification.reason === 'repost' ||
    notification.reason === 'zap'
  ) {
    return notification.targetEventId ?? notification.targetEvent?.id ?? notification.event.id;
  }
  return notification.event.id;
}

function notificationPreviewEvent(notification: FeedNotification): FeedEvent | undefined {
  if (
    notification.reason === 'reply' ||
    notification.reason === 'quote' ||
    notification.reason === 'mention'
  ) {
    return notification.event;
  }
  if (notification.targetEvent) return notification.targetEvent;
  return undefined;
}

function notificationTitle(name: string, reason: string, hasTargetEvent = false): string {
  switch (reason) {
    case 'follow':
      return `${name} followed you`;
    case 'reaction':
      return `${name} liked your post`;
    case 'repost':
      return `${name} reposted your post`;
    case 'zap':
      return hasTargetEvent ? `${name} zapped your post` : `${name} zapped you`;
    case 'reply':
      return hasTargetEvent ? `${name} replied to your post` : `${name} replied to you`;
    case 'quote':
      return `${name} quoted your post`;
    case 'mention':
      return `${name} mentioned you`;
    default:
      return `${name} ${notificationReasonLabel(reason)}`;
  }
}

const GROUP_ACTIONS: Record<'follow' | 'repost' | 'reaction' | 'zap', string> = {
  follow: 'followed you',
  repost: 'reposted your post',
  reaction: 'liked your post',
  zap: 'zapped your post',
};

function groupedNotificationTitle(
  names: readonly string[],
  count: number,
  reason: 'follow' | 'repost' | 'reaction' | 'zap',
  totalCapped = false
): string {
  const action = GROUP_ACTIONS[reason];
  if (count <= 0) return action;
  if (count === 1) return `${names[0]} ${action}`;
  if (count === 2) return `${names[0]} and ${names[1]} ${action}`;
  const others = count - 2;
  const moreLabel = totalCapped ? `${others}+ others` : `${others} others`;
  return `${names[0]}, ${names[1]} and ${moreLabel} ${action}`;
}

function notificationIcon(reason: string): string {
  switch (reason) {
    case 'follow':
      return 'la:user-plus';
    case 'reaction':
      return 'garden:heart-fill-16';
    case 'repost':
      return 'garden:arrow-retweet-fill-16';
    case 'zap':
      return 'mdi:lightning-bolt';
    case 'reply':
      return 'mdi:message-reply';
    case 'quote':
      return 'mdi:message-text';
    case 'mention':
      return 'mdi:at';
    default:
      return 'mdi:bell';
  }
}

function notificationTone(reason: string): string {
  switch (reason) {
    case 'follow':
    case 'reply':
    case 'mention':
    case 'quote':
      return '#1D9BF0';
    case 'reaction':
      return '#F91880';
    case 'repost':
      return '#00BA7C';
    case 'zap':
      return '#F59E0B';
    default:
      return '#71767B';
  }
}

function EmptyNotifications({
  viewerReady,
  errorMessage,
  foreground,
  muted,
}: {
  viewerReady: boolean;
  errorMessage: string | null;
  foreground: string;
  muted: string;
}) {
  const icon = errorMessage ? 'mdi:alert-circle-outline' : 'mdi:bell-outline';
  const title = errorMessage
    ? 'Notifications unavailable'
    : viewerReady
      ? 'No notifications'
      : 'No profile';
  const subtitle = errorMessage ? errorMessage : viewerReady ? '' : 'Nostr profile required';

  return (
    <VStack
      align="center"
      gap={12}
      style={notificationListStyles.emptyState}
      testID={`notifications-empty:${errorMessage ? 'error' : viewerReady ? 'none' : 'no-profile'}`}
      accessible
      accessibilityLabel={title}>
      <Icon name={icon} size={34} color={withAlpha(foreground, 0.45)} />
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text size={14} style={{ color: muted, textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  filtersRow: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 56,
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingLeft: 40,
  },
  reasonIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginTop: 7,
    width: 28,
  },
  welcomeGlyph: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  avatarCluster: {
    height: 46,
  },
  clusterAvatar: {
    borderRadius: 23,
    borderWidth: 2,
    height: 46,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    top: -2,
    width: 46,
  },
  referencedPost: {
    borderRadius: 10,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingRight: 4,
    paddingVertical: 0,
  },
  referencedPostContained: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    // Reason icon (28) + gaps — shallower inset than the follows screen's.
    marginLeft: 72,
  },
});
