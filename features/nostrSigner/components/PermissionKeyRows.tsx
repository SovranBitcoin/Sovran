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
import type { Nip46Connection } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuPopup } from '@/shared/lib/popup';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

export type TriState = 'ask' | 'allow' | 'block';
type PermissionRowState = TriState | 'mixed';

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
