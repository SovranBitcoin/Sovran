/**
 * "Receive via": what the Unified QR carries, as copy rows. The first row is
 * the whole bitcoin: link ("Unified link" — what the QR encodes and the footer
 * Copy hands out, too composite to verify by eye, so it shows no code); then
 * one row per rail (Onchain address, BOLT 12 offer, Cashu payment request),
 * each copying just its own value — the same bare value its own tab copies. A rail no trusted
 * mint can serve stays listed with the reason, so the user sees why.
 */

import { Fragment } from 'react';
import { ListGroup, Separator } from 'heroui-native';

import Icon from '@/assets/icons';
import type { Bip321RailSelection } from '@/features/receive/lib/bip321RailSelection';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import type { Bip321RailId } from '@/shared/stores/profile/mintStore';
import { CopyRequestRow } from '@/shared/ui/composed/CopyRequestCard';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { View } from '@/shared/ui/primitives/View/View';

const RAIL_ICON: Record<Bip321RailId, string> = {
  onchain: 'hugeicons:blockchain-01',
  bolt12: 'mingcute:lightning-fill',
  creq: 'ph:coins',
};

export function UnifiedRailsCard({
  selection,
  uri,
  values,
  loading,
  muted,
  onCopyUri,
  onCopyRail,
}: {
  selection: Bip321RailSelection;
  /** The composed bitcoin: link — the QR's payload. */
  uri: string | null;
  /** Each included rail's value as it appears in the URI; null while loading. */
  values: Record<Bip321RailId, string | null>;
  /** The URI is still composing: included rails show skeleton lines. */
  loading: boolean;
  muted: string;
  onCopyUri: (uri: string) => Promise<void>;
  onCopyRail: (id: Bip321RailId, value: string) => Promise<void>;
}) {
  const stateValue = selection.rails
    .map((rail) => `${rail.id}:${rail.state === 'included' && values[rail.id] ? '1' : '0'}`)
    .join(',');

  return (
    <View className="mx-4">
      <Section title="Receive via">
        <GradientCard>
          <ListGroup variant="transparent">
            <CopyRequestRow
              icon="stash:qr-code"
              parts={[{ label: 'Unified link', description: "The payer's wallet picks a method" }]}
              loading={loading || !uri}
              muted={muted}
              onPress={uri ? () => onCopyUri(uri) : undefined}
              testID="receive-unified-copy"
              accessibilityLabel="Copy unified link"
            />
            {selection.rails.map((rail) => {
              const value = values[rail.id];
              const icon = RAIL_ICON[rail.id];
              return (
                <Fragment key={rail.id}>
                  <Separator className="mx-4" />
                  {rail.state === 'included' ? (
                    <CopyRequestRow
                      icon={icon}
                      parts={[{ label: rail.label, value: value ?? '' }]}
                      loading={loading || !value}
                      muted={muted}
                      onPress={value ? () => onCopyRail(rail.id, value) : undefined}
                      testID={`receive-unified-copy-${rail.id}`}
                      accessibilityLabel={`Copy ${rail.label}`}
                    />
                  ) : (
                    <ListGroup.Item disabled testID={`receive-unified-unavailable-${rail.id}`}>
                      <ListGroup.ItemPrefix className="shrink-0">
                        <Icon name={icon} size={20} color={muted} />
                      </ListGroup.ItemPrefix>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>{rail.label}</ListGroup.ItemTitle>
                        {rail.reason ? (
                          <ListGroup.ItemDescription>{rail.reason}</ListGroup.ItemDescription>
                        ) : null}
                      </ListGroup.ItemContent>
                    </ListGroup.Item>
                  )}
                </Fragment>
              );
            })}
          </ListGroup>
        </GradientCard>
      </Section>
      <E2EAccessibilityProbe
        testID="receive-unified-rails-state"
        accessibilityLabel="Unified methods included"
        value={stateValue}
      />
    </View>
  );
}
