import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import React, { useCallback } from 'react';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';

import { DESIGN_SYSTEM_CATALOG } from '@/features/settings/design-system/catalog';
import type { DesignSystemFamily } from '@/features/settings/design-system/types';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';

const DesignSystemLinkItem: React.FC<DesignSystemFamily> = ({ id, href, title, description }) => {
  const handlePress = useCallback(() => router.navigate(href), [href]);

  return (
    <PressableFeedback
      testID={`design-system-family-${id}`}
      accessible
      accessibilityLabel={`${title}, ${description}`}
      accessibilityRole="button"
      animation={false}
      onPress={handlePress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
};

const openScreens = () => router.navigate('/(settings-flow)/design-system-screens');
const openVariations = () => router.navigate('/(settings-flow)/design-system-variations');

interface FlowLink {
  id: string;
  title: string;
  description: string;
  open: () => void;
}

/** One row that opens a real flow, for walking a style through the app. */
function FlowLinkItem({ id, title, description, open }: FlowLink) {
  return (
    <PressableFeedback
      testID={`design-system-flow-${id}`}
      accessible
      accessibilityLabel={`${title}, ${description}`}
      accessibilityRole="button"
      animation={false}
      onPress={open}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

/**
 * The flows worth walking after changing a style, each opened the way the
 * wallet opens it (Send and Receive go through the payment machine, so they
 * arrive with a real entry and not an error state). Nothing here moves money:
 * every flow stops at its first screen until the person acts.
 */
function useFlowLinks(): FlowLink[] {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  return [
    {
      id: 'send',
      title: 'Send',
      description: 'Method chooser, recipients, then amount and confirm',
      open: () => {
        clearPaymentContext('design-system.send');
        void machine.startSend({ reset: true });
      },
    },
    {
      id: 'receive',
      title: 'Receive',
      description: 'Method chooser, QR codes and fixed-amount requests',
      open: () => {
        clearPaymentContext('design-system.receive');
        void machine.startReceive({ reset: true });
      },
    },
    {
      id: 'transactions',
      title: 'Transactions',
      description: 'The full list, filters, and a transaction detail from any row',
      open: () => router.navigate('/(transactions-flow)/transactions'),
    },
    {
      id: 'add-mint',
      title: 'Add a mint',
      description: 'Mint discovery, reviews and mint details',
      open: () => router.navigate('/(mint-flow)/add'),
    },
    {
      id: 'wallpapers',
      title: 'Wallpapers',
      description: 'Albums and per-account wallpaper, to check a style over an image',
      open: () => router.navigate('/(theme-flow)/preview'),
    },
    {
      id: 'map',
      title: 'Bitcoin near me',
      description: 'The map and a place detail',
      open: () => router.navigate('/(map-flow)'),
    },
  ];
}

export function SettingsDesignSystemScreen() {
  const flows = useFlowLinks();
  return (
    <ScreenWrapper name="SettingsDesignSystemScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Live previews of shared UI components. Open one to see it in isolation — only the selected
          component animates, so the previews stay smooth.
        </Text>
        <Section title="Explore">
          <ListGroup variant="secondary">
            <PressableFeedback
              testID="design-system-screens-row"
              accessible
              accessibilityLabel="Screens, every transaction state, profile and mint screen on made-up data"
              accessibilityRole="button"
              animation={false}
              onPress={openScreens}>
              <PressableFeedback.Scale>
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Screens</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      Every transaction state, profile and mint screen, opened on made-up data.
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix />
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
            <Separator />
            <PressableFeedback
              testID="design-system-variations-row"
              accessible
              accessibilityLabel="Variations, candidate redesigns of one component, a tab each"
              accessibilityRole="button"
              animation={false}
              onPress={openVariations}>
              <PressableFeedback.Scale>
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Variations</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      Candidate redesigns of one component at a time, a tab each, on every case.
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix />
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          </ListGroup>
        </Section>
        <Section title="Flows">
          <ListGroup variant="secondary">
            {flows.map((flow, index) => (
              <React.Fragment key={flow.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <FlowLinkItem {...flow} />
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>
        <Section title="Components">
          <ListGroup variant="secondary">
            {DESIGN_SYSTEM_CATALOG.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <DesignSystemLinkItem {...entry} />
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>
      </ScreenScrollView>
    </ScreenWrapper>
  );
}
