/**
 * The Cashu-payment-request customization card — the copyable request row plus
 * the P2PK-lock toggle and the Advanced per-mint advertise switches. Shared by
 * the receive "QR Display" Cashu tab (a standing amountless request) and the
 * single-use "Fixed Amount → as Ecash" screen so both offer the SAME
 * customization with one implementation.
 *
 * The card is presentational: the caller owns the request encoding and the
 * customization state (global preference for the hub, or per-request), and
 * feeds a derived `CreqMintSelection` in. Toggling only re-encodes the
 * displayed request; the durable coco operation keeps its full mint list and
 * stays lock-free (coco rejects nut10 on incoming — the lock rides the display
 * encoding, and the claim path signs the keyring 'p2pk' key transparently).
 */

import React, { memo, useCallback, useEffect, useState } from 'react';

import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';
import { setStringAsync } from 'expo-clipboard';

import type { CreqMintSelection } from '@/features/receive/lib/creqMintSelection';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { View } from '@/shared/ui/primitives/View/View';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { copyPopup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { paymentLog } from '@/shared/lib/logger';
import Icon from 'assets/icons';

interface CreqCustomizationCardProps {
  /** The (already re-encoded) request string shown in the copy row. */
  encodedRequest: string;
  muted: string;
  /** Latest keyring P2PK pubkey (02-prefixed) — absent → lock toggle disabled. */
  p2pkKey?: string;
  mintSelection: CreqMintSelection;
  /** Whether the user wants the P2PK lock on (the raw preference, pre-gating). */
  p2pkLockOn: boolean;
  onP2pkLockChange: (enabled: boolean) => void;
  /** advertise=false means "exclude this mint from the request". */
  onMintToggle: (mintUrl: string, advertise: boolean) => void;
  /**
   * Optional BATCH reset — advertise all the given mints at once. Consumers that
   * persist the exclusion set as a whole object (rather than one incremental
   * per-mint store write) MUST supply this, or a synchronous per-mint
   * `onMintToggle` loop clobbers itself (each call recomputing from the same
   * pre-reset snapshot). When omitted, the reset falls back to the per-mint loop.
   */
  onResetExclusions?: (advertiseMintUrls: string[]) => void;
  /** Section heading (defaults to "CASHU PAYMENT REQUEST"). Pass `null` to
   *  render the card with no section header (and no header spacing). */
  sectionTitle?: string | null;
}

export const CreqCustomizationCard = memo(function CreqCustomizationCard({
  encodedRequest,
  muted,
  p2pkKey,
  mintSelection,
  p2pkLockOn,
  onP2pkLockChange,
  onMintToggle,
  onResetExclusions,
  sectionTitle = 'CASHU PAYMENT REQUEST',
}: CreqCustomizationCardProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Contradictory persisted state: the lock is on but every NUT-11-capable mint
  // was toggled off earlier (while the lock was off). The selection already
  // advertises the capable set (never an empty "any mint" list); clear the
  // stale exclusions so the switches match what's advertised.
  useEffect(() => {
    if (!mintSelection.needsExclusionReset) return;
    const advertise = mintSelection.options.filter((o) => o.enabled).map((o) => o.mintUrl);
    paymentLog.warn('receive.creq.exclusions_reset', { count: advertise.length });
    if (onResetExclusions) {
      onResetExclusions(advertise);
    } else {
      // Incremental-store consumers (the hub tab) apply each removal safely.
      for (const mintUrl of advertise) onMintToggle(mintUrl, true);
    }
  }, [mintSelection, onMintToggle, onResetExclusions]);

  const handleCopy = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(encodedRequest);
    copyPopup('paymentRequest');
    paymentLog.info('receive.creq.copied', { requestLength: encodedRequest.length });
  }, [encodedRequest]);

  const handleAdvancedToggle = useCallback(() => {
    setAdvancedOpen((open) => {
      paymentLog.info('receive.creq.advanced_toggled', { open: !open });
      return !open;
    });
  }, []);

  const card = (
    <GradientCard>
      <ListGroup variant="transparent">
        <PressableFeedback animation={false} onPress={handleCopy}>
          <PressableFeedback.Scale>
            <ListGroup.Item disabled>
              <ListGroup.ItemPrefix>
                <Icon name="ph:coins" size={20} color={muted} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{truncateMiddle(encodedRequest, 10)}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Icon name="lets-icons:copy" size={20} color={muted} />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </PressableFeedback.Scale>
          <PressableFeedback.Ripple />
        </PressableFeedback>
        <Separator className="mx-4" />
        <ListGroup.Item>
          <ListGroup.ItemPrefix>
            <Icon name="solar:key-bold" size={20} color={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>P2PK lock</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>
              {!p2pkKey
                ? 'No P2PK key — generate one in Settings'
                : !mintSelection.hasP2pkCapableMint
                  ? 'None of your mints support P2PK locks'
                  : 'Payers lock ecash to your key'}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <HeroSwitch
              isSelected={p2pkLockOn && !!p2pkKey && mintSelection.hasP2pkCapableMint}
              isDisabled={!p2pkKey || !mintSelection.hasP2pkCapableMint}
              onSelectedChange={(value) => {
                paymentLog.info('receive.creq.p2pk_lock_toggled', { enabled: value });
                onP2pkLockChange(value);
              }}
            />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
        <Separator className="mx-4" />
        <PressableFeedback animation={false} onPress={handleAdvancedToggle}>
          <PressableFeedback.Scale>
            <ListGroup.Item disabled>
              <ListGroup.ItemPrefix>
                <Icon name="material-symbols:settings-rounded" size={20} color={muted} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Advanced</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {`${mintSelection.advertisedCount} of ${mintSelection.totalCount} mint${
                    mintSelection.totalCount === 1 ? '' : 's'
                  } in this request`}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Icon
                  name={advancedOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                  size={20}
                  color={muted}
                />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </PressableFeedback.Scale>
          <PressableFeedback.Ripple />
        </PressableFeedback>
        {advancedOpen
          ? mintSelection.options.map((option) => (
              <React.Fragment key={option.mintUrl}>
                <Separator className="mx-4" />
                <ListGroup.Item>
                  <ListGroup.ItemPrefix>
                    <MintIcon
                      iconUrl={option.iconUrl}
                      size={28}
                      name={option.displayName}
                      alt={`${option.displayName} icon`}
                    />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{option.displayName}</ListGroup.ItemTitle>
                    {option.reason ? (
                      <ListGroup.ItemDescription>{option.reason}</ListGroup.ItemDescription>
                    ) : null}
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <HeroSwitch
                      isSelected={option.enabled}
                      isDisabled={option.switchDisabled}
                      onSelectedChange={(value) => onMintToggle(option.mintUrl, value)}
                    />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </React.Fragment>
            ))
          : null}
      </ListGroup>
    </GradientCard>
  );

  return (
    <View className="mx-4">
      {sectionTitle ? <Section title={sectionTitle}>{card}</Section> : card}
    </View>
  );
});
