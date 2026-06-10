/**
 * @fileoverview Permission switch rows — shared by the per-app editor and the
 * Advanced (per-action) screen
 *
 * One ListGroup row per permission with a Switch: tap toggles Allow ↔ Ask,
 * long-press opens the Allow / Ask / Block action menu (Block is deliberately
 * one gesture deeper — it's the rare, destructive choice and renders red).
 * The top-level editor speaks in capability BUNDLES; per-key granularity
 * (and the "(kind N)" disambiguation jargon) lives on the Advanced screen.
 */

import React, { useCallback } from 'react';
import { ListGroup, PressableFeedback, Switch as HeroSwitch } from 'heroui-native';

import Icon from 'assets/icons';
import {
  alwaysAllowEligible,
  permissionEntryForGrantKey,
  type PermissionEditorGroup,
} from '@/features/nostrSigner/components/permissionCatalog';
import type { Nip46Connection } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuPopup } from '@/shared/lib/popup';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

export type TriState = 'ask' | 'allow' | 'block';
export type PermissionRowState = TriState | 'mixed';

const ALLOW_INELIGIBLE_REASON = 'Always requires approval';
const ROW_HINT = 'Double tap to toggle. Long press for more options.';
const MENU_ALLOW_DESCRIPTION = 'Sign without asking';
const MENU_ASK_DESCRIPTION = 'Ask you every time';
const MENU_BLOCK_DESCRIPTION = 'Deny without asking';

export function triStateFor(app: Nip46Connection, grantKey: GrantKey): TriState {
  const verdict = app.grants[grantKey]?.verdict;
  if (verdict === 'always') return 'allow';
  if (verdict === 'deny') return 'block';
  return 'ask';
}

/**
 * Friendly per-kind notes — deliberately plainer than the NIPs' own naming;
 * the "kind N" suffix carries the exact protocol identity.
 */
const KIND_NOTES: Record<number, string> = {
  1: 'Text note',
  1111: 'Comment on articles & media',
  6: 'Repost a note',
  16: 'Repost articles & media',
  7: 'Reaction',
  0: 'Profile details',
  3: 'Follow list',
  5: 'Delete request',
  10002: 'Relay list',
  30023: 'Long-form article',
  30078: 'App settings data',
  9734: 'Zap request',
  22242: 'Relay login',
  27235: 'Website login',
  4: 'Legacy direct message',
  13: 'Sealed private message',
  17375: 'Cashu wallet info',
};

const METHOD_NOTES: Partial<Record<string, string>> = {
  nip04_encrypt: 'Legacy encryption (NIP-04)',
  nip44_encrypt: 'Modern encryption (NIP-44)',
  nip04_decrypt: 'Legacy encryption (NIP-04)',
  nip44_decrypt: 'Modern encryption (NIP-44)',
};

/** Kind/method subtitle so rows sharing a catalog label stay distinguishable. */
function grantKeySubtitle(grantKey: GrantKey): string {
  const { method, kind } = parseGrantKey(grantKey);
  if (method === 'sign_event' && kind !== undefined) {
    const note = KIND_NOTES[kind];
    return note !== undefined ? `${note} · kind ${kind}` : `Event kind ${kind}`;
  }
  return METHOD_NOTES[method] ?? method;
}

function stateLabel(state: PermissionRowState, allowEligible: boolean): string {
  switch (state) {
    case 'allow':
      return 'Always';
    case 'ask':
      return allowEligible ? 'Ask' : 'Always asks';
    case 'block':
      return 'Blocked';
    case 'mixed':
      return 'Custom';
  }
}

/**
 * One permission row: Switch ON = Allow, OFF = Ask; Block lives behind the
 * long-press menu and renders as an ACTIVE RED switch. Tap semantics:
 * allow→ask, ask→allow, block→ask (de-escalate), mixed→allow; an
 * Allow-ineligible row's tap opens the menu instead (a dead tap on a visible
 * row is worse).
 */
export function PermissionSwitchRow({
  label,
  subtitle,
  state,
  allowEligible,
  onChange,
}: {
  label: string;
  /** Extra context under the status (e.g. "Event kind 1111"). */
  subtitle?: string;
  state: PermissionRowState;
  allowEligible: boolean;
  onChange: (next: TriState) => void;
}) {
  const [danger, muted] = useThemeColor(['danger', 'muted'] as const);
  const blocked = state === 'block';

  const openMenu = useCallback(() => {
    const checkSuffix = <Icon name="mdi:check" size={18} color={muted} />;
    actionMenuPopup({
      title: label,
      buttons: [
        {
          text: 'Allow',
          icon: 'mdi:check-circle',
          description: MENU_ALLOW_DESCRIPTION,
          ...(state === 'allow' && { suffix: checkSuffix }),
          disabled: !allowEligible,
          ...(!allowEligible && { reason: ALLOW_INELIGIBLE_REASON }),
          onPress: (close) => {
            close();
            onChange('allow');
          },
        },
        {
          text: 'Ask',
          icon: 'mdi:help-circle',
          description: MENU_ASK_DESCRIPTION,
          ...(state === 'ask' && { suffix: checkSuffix }),
          variant: 'secondary',
          onPress: (close) => {
            close();
            onChange('ask');
          },
        },
        {
          text: 'Block',
          icon: 'mdi:cancel',
          description: MENU_BLOCK_DESCRIPTION,
          ...(state === 'block' && { suffix: checkSuffix }),
          variant: 'dangerous',
          onPress: (close) => {
            close();
            onChange('block');
          },
        },
      ],
    });
  }, [label, state, allowEligible, onChange, muted]);

  const onTap = useCallback(() => {
    if (state === 'block') {
      onChange('ask');
      return;
    }
    if (!allowEligible) {
      openMenu();
      return;
    }
    onChange(state === 'allow' ? 'ask' : 'allow');
  }, [state, allowEligible, onChange, openMenu]);

  const status = stateLabel(state, allowEligible);
  const description = subtitle !== undefined ? `${status} · ${subtitle}` : status;

  return (
    <PressableFeedback
      animation={false}
      onPress={onTap}
      onLongPress={openMenu}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: status }}
      accessibilityHint={ROW_HINT}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>
              {blocked ? <Text style={{ color: danger }}>{label}</Text> : label}
            </ListGroup.ItemTitle>
            <ListGroup.ItemDescription>
              {blocked ? <Text style={{ color: danger }}>{description}</Text> : description}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            {/* The switch is a pure visual — its root is a Pressable that
                would otherwise swallow the row's taps. Blocked renders as an
                ACTIVE red switch (tap flips it back to Ask). */}
            <View pointerEvents="none">
              <HeroSwitch
                isSelected={blocked || state === 'allow'}
                isDisabled={!allowEligible && !blocked}
                {...(blocked && {
                  animation: { backgroundColor: { value: [danger, danger] as [string, string] } },
                })}
              />
            </View>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

export interface PermissionKeyRowModel {
  grantKey: GrantKey;
  displayLabel: string;
  /** Kind/method note ("Event kind 1111") when the label alone is ambiguous. */
  subtitle?: string;
  allowEligible: boolean;
  group: PermissionEditorGroup;
}

/**
 * Per-key rows for an app's grants: the canonical base keys ∪ every stored
 * grant key, label-deduped. Unknown-kind extras ALWAYS carry the kind
 * subtitle — without it two odd-kind grants are indistinguishable.
 */
export function buildPermissionKeyRows(
  baseKeys: readonly GrantKey[],
  grants: Nip46Connection['grants'],
  group?: PermissionEditorGroup
): PermissionKeyRowModel[] {
  const keys: GrantKey[] = [...baseKeys];
  const extras = (Object.keys(grants) as GrantKey[]).filter((key) => !keys.includes(key)).sort();
  keys.push(...extras);

  const base = keys.map((grantKey) => ({
    grantKey,
    entry: permissionEntryForGrantKey(grantKey),
    allowEligible: alwaysAllowEligible(parseGrantKey(grantKey)),
  }));
  return base
    .filter((row) => group === undefined || row.entry.permissionEditorGroup === group)
    .map((row) => ({
      grantKey: row.grantKey,
      allowEligible: row.allowEligible,
      group: row.entry.permissionEditorGroup,
      displayLabel: row.entry.permissionEditorLabel,
      // Advanced is the precise surface: every row carries its exact kind.
      subtitle: grantKeySubtitle(row.grantKey),
    }));
}
