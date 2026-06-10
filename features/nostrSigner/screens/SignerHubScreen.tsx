/**
 * @fileoverview Signer hub — pending queue entry, connected apps, connect
 * actions, and the activity link
 *
 * Sections (plan "Routes → index"):
 *   Pending        — only when the runtime queue is non-empty; one prominent
 *                    row into the requests page.
 *   Connected Apps — one row per paired app → app-detail permission editor;
 *                    empty state invites the first QR scan.
 *   Connect        — Scan QR (camera with the signer-pair action), Paste
 *                    Connection Link (actionMenuPopup input → shared
 *                    openPairingFromUri dispatch), Share My Signer.
 *   History        — Activity log link.
 *
 * The plan's passive "Connections for other profiles are paused…" banner is
 * intentionally absent: the connections store is profile-scoped storage, so
 * the active profile structurally cannot read whether OTHER profiles have
 * connections. Detecting it would require cross-profile storage reads, which
 * the per-pubkey scoping forbids — documented as not applicable for v1.
 *
 * App names come from connection metadata (client-supplied = untrusted);
 * everything renders through the catalog's bounded helpers and is never
 * logged.
 */

import React, { useCallback, useMemo } from 'react';

import Icon from 'assets/icons';
import { appDisplayName } from '@/features/nostrSigner/components/permissionCatalog';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
} from '@/features/nostrSigner/lib/openPairingFromUri';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { actionMenuPopup } from '@/shared/lib/popup';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';

// ── Copy (plan verbatim; templates interpolated) ────────────────

const PENDING_ROW_SUBTITLE = 'Tap to review';

const APPS_EMPTY_TITLE = 'No apps connected';
const APPS_EMPTY_SUBTITLE =
  'Scan a QR code from any Nostr app to sign in with your Sovran identity.';

const SCAN_QR_LABEL = 'Scan QR Code';
const PASTE_LINK_LABEL = 'Paste Connection Link';
const SHARE_SIGNER_LABEL = 'Share My Signer';

const PASTE_PROMPT_BODY = 'Paste the connection link from the app you want to sign in to.';
const PASTE_CONNECT_LABEL = 'Connect';

const ACTIVITY_ROW_TITLE = 'Activity';
const ACTIVITY_ROW_SUBTITLE = 'Signatures, approvals and denials';

function pendingRowTitle(count: number): string {
  return count === 1 ? '1 request waiting' : `${count} requests waiting`;
}

/** "Last used 2h ago · N allowed" (plan template; "Never used" pre-first-use). */
function connectionSubtitle(connection: Nip46Connection): string {
  const lastUsed =
    connection.lastUsedAt === undefined
      ? 'Never used'
      : `Last used ${formatRelative(connection.lastUsedAt, 'compact')}`;
  const allowedCount = Object.values(connection.grants).filter(
    (grant) => grant?.verdict === 'always'
  ).length;
  return `${lastUsed} · ${allowedCount} allowed`;
}

// ── Screen ──────────────────────────────────────────────────────

export function SignerHubScreen(): React.ReactElement {
  useLifecycleLogger('SignerHubScreen');
  const pendingCount = useNip46RequestsStore((s) => s.pending.length);
  const apps = useNip46ConnectionsStore((s) => s.apps);
  const [foreground, warning] = useThemeColor(['foreground', 'warning'] as const);

  const connections = useMemo(
    () =>
      Object.values(apps).sort(
        (a, b) => (b.lastUsedAt ?? b.pairedAt) - (a.lastUsedAt ?? a.pairedAt)
      ),
    [apps]
  );

  // ── Navigation ────────────────────────────────────────────────

  const openRequests = useCallback(() => {
    router.push('/(signer-flow)/requests' as never);
  }, []);

  const openAppDetail = useCallback((clientPubkey: string) => {
    // Hex pubkey — URL-safe by construction, no encoding needed.
    router.push(`/(signer-flow)/app?clientPubkey=${clientPubkey}` as never);
  }, []);

  const openScan = useCallback(() => {
    // signer-pair mode: the standalone camera only accepts NIP-46 URIs.
    router.navigate({ pathname: '/camera', params: { action: 'signer-pair' } });
  }, []);

  const openShare = useCallback(() => {
    router.push('/(signer-flow)/share' as never);
  }, []);

  const openActivity = useCallback(() => {
    router.push('/(signer-flow)/activity' as never);
  }, []);

  // ── Paste Connection Link ─────────────────────────────────────

  const openPasteLink = useCallback(() => {
    actionMenuPopup({
      title: PASTE_LINK_LABEL,
      inputs: [
        {
          id: 'uri',
          placeholder: 'nostrconnect://…',
          description: PASTE_PROMPT_BODY,
          autoCapitalize: 'none',
          autoCorrect: false,
        },
      ],
      primaryAction: {
        text: PASTE_CONNECT_LABEL,
        isDisabled: (values) => !values.uri || values.uri.trim().length === 0,
        onPress: (values, { setError, close }) => {
          const raw = (values.uri ?? '').trim();
          // The URI embeds the pairing secret — never log it. Shared Layer-4
          // dispatch: validate → hot flag → engine pairing → close the menu
          // (beforeOpen) → connect sheet.
          const opened = openPairingFromUri(raw, { beforeOpen: close });
          if (opened.isErr()) {
            setError(
              opened.error.type === 'bunker-unsupported'
                ? PAIRING_ERROR_BUNKER
                : PAIRING_ERROR_INVALID_LINK
            );
          }
        },
      },
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────

  return (
    <Screen name="SignerHubScreen">
      {pendingCount > 0 ? (
        <Section title="Pending">
          <ListRow
            iconCircle={{ icon: 'mdi:bell', color: warning }}
            title={pendingRowTitle(pendingCount)}
            subtitle={PENDING_ROW_SUBTITLE}
            trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
            onPress={openRequests}
            testID="signer-hub-pending-row"
          />
        </Section>
      ) : null}

      <Section title="Connected Apps">
        {connections.length === 0 ? (
          <EmptyState
            icon="mdi:qrcode-scan"
            title={APPS_EMPTY_TITLE}
            subtitle={APPS_EMPTY_SUBTITLE}
          />
        ) : (
          connections.map((connection) => (
            <ListRow
              key={connection.clientPubkey}
              leading={
                <Avatar
                  state={connection.image ? 'image' : 'fallback'}
                  picture={connection.image}
                  seed={connection.clientPubkey}
                  fallbackVariant="beam"
                  size={44}
                  alt={appDisplayName(connection)}
                />
              }
              title={appDisplayName(connection)}
              subtitle={connectionSubtitle(connection)}
              trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
              onPress={() => openAppDetail(connection.clientPubkey)}
            />
          ))
        )}
      </Section>

      <Section title="Connect">
        <ListRow
          iconCircle={{ icon: 'mdi:qrcode-scan', color: foreground }}
          title={SCAN_QR_LABEL}
          onPress={openScan}
          testID="signer-hub-scan-row"
        />
        <ListRow
          iconCircle={{ icon: 'lucide:clipboard-paste', color: foreground }}
          title={PASTE_LINK_LABEL}
          onPress={openPasteLink}
          testID="signer-hub-paste-row"
        />
        <ListRow
          iconCircle={{ icon: 'mdi:share-variant', color: foreground }}
          title={SHARE_SIGNER_LABEL}
          onPress={openShare}
          testID="signer-hub-share-row"
        />
      </Section>

      <Section title="History">
        <ListRow
          iconCircle={{ icon: 'lucide:activity', color: foreground }}
          title={ACTIVITY_ROW_TITLE}
          subtitle={ACTIVITY_ROW_SUBTITLE}
          trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
          onPress={openActivity}
          testID="signer-hub-activity-row"
        />
      </Section>
    </Screen>
  );
}
