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
import { ListGroup, Separator } from 'heroui-native';

import Icon from 'assets/icons';
import { appDisplayName } from '@/features/nostrSigner/components/permissionCatalog';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { clearAllSignerData } from '@/features/nostrSigner/lib/clearSignerData';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
} from '@/features/nostrSigner/lib/openPairingFromUri';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { actionMenuPopup, popup } from '@/shared/lib/popup';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

// ── Copy (plan verbatim; templates interpolated) ────────────────

const PENDING_ROW_SUBTITLE = 'Tap to review';

const APPS_EMPTY_TITLE = 'No apps connected';
const APPS_EMPTY_SUBTITLE =
  'Scan a QR code from any Nostr app to sign in with your Sovran identity.';

const SCAN_QR_LABEL = 'Scan QR Code';
const SCAN_QR_SUBTITLE = 'Sign in to a Nostr app showing a connect code';
const PASTE_LINK_LABEL = 'Paste Connection Link';
const PASTE_LINK_SUBTITLE = "Connect with a copied link when there's no code to scan";
const SHARE_SIGNER_LABEL = 'Share Remote Login';
const SHARE_SIGNER_SUBTITLE = 'Show a code other apps can scan to sign in as you';

const PASTE_PROMPT_BODY = 'Paste the connection link from the app you want to sign in to.';
const PASTE_CONNECT_LABEL = 'Connect';

const ACTIVITY_ROW_TITLE = 'Activity';
const ACTIVITY_ROW_SUBTITLE = 'Signatures, approvals and denials';

const RESET_SIGNER_LABEL = 'Reset Remote Login';
const RESET_SIGNER_SUBTITLE = 'Disconnect every app and clear all permissions and history';
const RESET_CONFIRM_BODY =
  'Every connected app will be signed out, and all permissions, pending requests, and history will be cleared. Apps can reconnect anytime.';
const RESET_SUCCESS_MESSAGE = 'Remote Login reset';
const RESET_FAILURE_MESSAGE = 'Some signer data could not be cleared';
const RESET_BODY_TEXT_STYLE = { lineHeight: 20 } as const;

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
  const { keys } = useNostrKeysContext();
  const [foreground, warning, danger, muted] = useThemeColor([
    'foreground',
    'warning',
    'danger',
    'muted',
  ] as const);
  const dangerTextStyle = useMemo(() => ({ color: danger }), [danger]);

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
          // dispatch: validate → hot flag → engine pairing → queue the connect
          // sheet behind the paste menu's completed native dismissal.
          const opened = openPairingFromUri(raw, { scheduleOpen: close });
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

  // ── Reset Remote Login ────────────────────────────────────────

  const confirmReset = useCallback(() => {
    const activePubkey = keys?.pubkey;
    actionMenuPopup({
      title: RESET_SIGNER_LABEL,
      header: (
        <View className="px-2 pb-2">
          <Text size={14} style={RESET_BODY_TEXT_STYLE}>
            {RESET_CONFIRM_BODY}
          </Text>
        </View>
      ),
      buttons: [
        {
          text: 'Reset',
          variant: 'dangerous',
          onPress: (close) => {
            close();
            void clearAllSignerData(activePubkey).match(
              () => popup({ message: RESET_SUCCESS_MESSAGE, type: 'success' }),
              () => popup({ message: RESET_FAILURE_MESSAGE, type: 'error' })
            );
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
      ],
    });
  }, [keys?.pubkey]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <Screen name="SignerHubScreen">
      {/* The paste-link popup is a FullWindowOverlay action sheet whose input
          and buttons never reach iOS AX — this marker is the waitable evidence
          e2e uses before typing/tapping by coordinate. */}
      <E2EActionMenuProbe />
      {pendingCount > 0 ? (
        <Section title="Pending">
          <ListGroup variant="secondary">
            <ListRow
              icon={{ name: 'mdi:bell', color: warning }}
              title={pendingRowTitle(pendingCount)}
              subtitle={PENDING_ROW_SUBTITLE}
              wrapSubtitle
              trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
              onPress={openRequests}
              testID="signer-hub-pending-row"
            />
          </ListGroup>
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
          <ListGroup variant="secondary">
            {connections.map((connection, index) => (
              <React.Fragment key={connection.clientPubkey}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListRow
                  leading={
                    <Avatar
                      state={connection.image ? 'image' : 'fallback'}
                      picture={connection.image}
                      seed={connection.clientPubkey}
                      size={44}
                      alt={appDisplayName(connection)}
                    />
                  }
                  title={appDisplayName(connection)}
                  subtitle={connectionSubtitle(connection)}
                  wrapSubtitle
                  trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
                  onPress={() => openAppDetail(connection.clientPubkey)}
                />
              </React.Fragment>
            ))}
          </ListGroup>
        )}
      </Section>

      <Section title="Connect">
        <ListGroup variant="secondary">
          <ListRow
            icon={{ name: 'mdi:qrcode-scan' }}
            title={SCAN_QR_LABEL}
            subtitle={SCAN_QR_SUBTITLE}
            wrapSubtitle
            onPress={openScan}
            testID="signer-hub-scan-row"
          />
          <Separator className="mx-4" />
          <ListRow
            icon={{ name: 'lucide:clipboard-paste' }}
            title={PASTE_LINK_LABEL}
            subtitle={PASTE_LINK_SUBTITLE}
            wrapSubtitle
            onPress={openPasteLink}
            testID="signer-hub-paste-row"
          />
          <Separator className="mx-4" />
          <ListRow
            icon={{ name: 'mdi:share-variant' }}
            title={SHARE_SIGNER_LABEL}
            subtitle={SHARE_SIGNER_SUBTITLE}
            wrapSubtitle
            onPress={openShare}
            testID="signer-hub-share-row"
          />
        </ListGroup>
      </Section>

      <Section title="History">
        <ListGroup variant="secondary">
          <ListRow
            icon={{ name: 'lucide:activity' }}
            title={ACTIVITY_ROW_TITLE}
            subtitle={ACTIVITY_ROW_SUBTITLE}
            wrapSubtitle
            trailing={<Icon name="mdi:chevron-right" size={20} color={foreground} />}
            onPress={openActivity}
            testID="signer-hub-activity-row"
          />
        </ListGroup>
      </Section>

      <Section title="Danger Zone" isDanger>
        <ListGroup variant="secondary">
          <ListRow
            title={
              <Text size={16} bold style={dangerTextStyle}>
                {RESET_SIGNER_LABEL}
              </Text>
            }
            subtitle={RESET_SIGNER_SUBTITLE}
            wrapSubtitle
            accessibilityLabel={RESET_SIGNER_LABEL}
            trailing={<Icon name="mdi:chevron-right" size={18} color={muted} />}
            onPress={confirmReset}
            testID="signer-hub-reset-row"
          />
        </ListGroup>
      </Section>
    </Screen>
  );
}
