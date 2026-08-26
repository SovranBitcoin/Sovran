/**
 * @fileoverview Advanced per-action permissions for ONE risk group
 *
 * The per-app editor speaks in capability bundles; this screen is the
 * precision surface behind its "Advanced" link — every grant key in the
 * group as its own switch row (tap toggles Allow ↔ Ask, long-press for the
 * Allow/Ask/Block menu), sectioned by the bundle each action belongs to,
 * with an "Other" section for unbundled/locked/odd-kind extras (the only
 * place "(kind N)" disambiguation appears). Edits hit the same store the
 * top-level bundles derive from, so bundle states update live (a partial
 * change reads as "Custom" there).
 *
 * Route params: `clientPubkey` (64-hex) + `group` (risk group id).
 */

import React from 'react';
import { ListGroup, Separator } from 'heroui-native';
import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import {
  PermissionSwitchRow,
  triStateFor,
  type TriState,
} from '@/features/nostrSigner/components/PermissionKeyRows';
import {
  buildPermissionKeyRows,
  sessionStatusFor,
  type PermissionKeyRowModel,
} from '@/features/nostrSigner/components/permissionRowModel';
import { BASE_EDITOR_GRANT_KEYS } from '@/features/nostrSigner/components/editorGrantKeys';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import {
  bundleForGrantKey,
  PERMISSION_BUNDLES,
} from '@/features/nostrSigner/lib/permissionBundles';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nostrLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const GROUP_TITLES = {
  public: 'Public Posting',
  account: 'Account & Profile',
  signin: 'Sign-ins',
  private: 'Private Data',
  wallet: 'Wallet',
} as const;

const OTHER_SECTION_TITLE = 'Other';
const FOOTER =
  'Tap a permission to toggle Allow. Long-press for Ask / Allow / Block. Everything is logged in Activity.';

const ParamsSchema = z.object({
  clientPubkey: z.string().refine(isNostrPubkeyHex),
  group: z.enum(['public', 'account', 'signin', 'private', 'wallet']),
});

interface RowSection {
  title: string | null;
  rows: PermissionKeyRowModel[];
}

/**
 * One section per bundle the group contains, then "Other" for unbundled
 * rows (locked keys, odd-kind extras). filter preserves row order.
 */
function buildRowSections(
  app: { grants: Parameters<typeof buildPermissionKeyRows>[1] } | undefined,
  group: z.infer<typeof ParamsSchema>['group'] | undefined
): RowSection[] {
  if (app === undefined || group === undefined) return [];
  const rows = buildPermissionKeyRows(BASE_EDITOR_GRANT_KEYS, app.grants, group);
  const bundleSections: RowSection[] = PERMISSION_BUNDLES.filter((bundle) => bundle.group === group)
    .map((bundle) => ({
      title: bundle.label,
      rows: rows.filter((row) => bundleForGrantKey(row.grantKey)?.id === bundle.id),
    }))
    .filter((section) => section.rows.length > 0);
  const otherRows = rows.filter((row) => bundleForGrantKey(row.grantKey) === null);
  if (otherRows.length > 0) {
    bundleSections.push({
      // A lone card needs no redundant "Other" header (wallet group).
      title: bundleSections.length > 0 ? OTHER_SECTION_TITLE : null,
      rows: otherRows,
    });
  }
  return bundleSections;
}

export function SignerAppPermissionsScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ clientPubkey?: string; group?: string }>();
  const parsed = ParamsSchema.safeParse(params);
  const clientPubkey = parsed.success ? parsed.data.clientPubkey : undefined;
  const group = parsed.success ? parsed.data.group : undefined;

  const app = useNip46ConnectionsStore((s) =>
    clientPubkey === undefined ? undefined : s.apps[clientPubkey]
  );
  const setGrant = useNip46ConnectionsStore((s) => s.setGrant);
  const muted = useThemeColor('muted');

  // Live session state, so a row never reads "Always asks" while a session
  // grant/allow is quietly auto-approving it (until restart). Strict mode
  // suppresses these labels — evaluate() asks before session checks there,
  // so the persisted labels are the truthful ones.
  const strictModeOn = app?.mode === 'strict';
  const sessionGrants = useNip46RequestsStore((s) => s.sessionGrants);
  const sessionAllows = useNip46RequestsStore((s) => s.sessionAllows);
  const appSessionGrants =
    clientPubkey === undefined
      ? []
      : sessionGrants.filter((grant) => grant.clientPubkey === clientPubkey);
  const appSessionAllows =
    clientPubkey === undefined
      ? []
      : sessionAllows.filter((allow) => allow.clientPubkey === clientPubkey);

  const sections: RowSection[] = buildRowSections(app, group);

  const onChange = (grantKey: GrantKey, state: TriState) => {
    if (clientPubkey === undefined) return;
    const verdict = state === 'ask' ? null : state === 'allow' ? 'always' : 'deny';
    const result = setGrant(clientPubkey, grantKey, verdict);
    if (result.isErr()) {
      nostrLog.warn('nostr.signer.app_permissions.set_grant_failed', { error: result.error });
    }
  };

  if (app === undefined || group === undefined) {
    return (
      <Screen name="SignerAppPermissionsScreen">
        <View />
      </Screen>
    );
  }

  return (
    <Screen name="SignerAppPermissionsScreen">
      <VStack gap={8} className="pb-8 pt-2">
        {sections.map((section) => (
          <View key={section.title ?? GROUP_TITLES[group]}>
            <Text
              className="text-foreground/50 mb-1 ml-3 mt-1 uppercase tracking-wide"
              size={12}
              medium>
              {section.title ?? GROUP_TITLES[group]}
            </Text>
            <ListGroup variant="secondary">
              {section.rows.map((row, index) => (
                <React.Fragment key={row.grantKey}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <PermissionSwitchRow
                    label={row.displayLabel}
                    {...(row.subtitle !== undefined && { subtitle: row.subtitle })}
                    state={triStateFor(app, row.grantKey)}
                    allowEligible={row.allowEligible}
                    sessionStatus={
                      strictModeOn
                        ? undefined
                        : sessionStatusFor(row.grantKey, appSessionGrants, appSessionAllows)
                    }
                    onChange={(state) => onChange(row.grantKey, state)}
                  />
                </React.Fragment>
              ))}
            </ListGroup>
          </View>
        ))}
        <Text className="ml-3" size={12} color={muted} style={{ lineHeight: 17 }}>
          {FOOTER}
        </Text>
      </VStack>
    </Screen>
  );
}
