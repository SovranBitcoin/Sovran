/**
 * "Choose amount" custom sheet — round-up / round-down / change-mint when
 * the entered amount doesn't compose exactly from available proofs. Routed
 * through `PopupHost`'s heroui standalone `<BottomSheet>` so it mounts inside
 * iOS FullWindowOverlay (above the send-flow route modal). Same reason as
 * `paymentOptionsSheet.tsx` — heroui `<Menu presentation="bottom-sheet">`
 * silently fails to mount inside FWO, so the menu lane renders below route
 * modals and the picker is invisible.
 */

import React from 'react';
import { View } from 'react-native';
import { BottomSheet, Menu } from 'heroui-native';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { HStack } from '@/shared/ui/primitives/View/HStack';

import { showActionSheet } from './bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

interface SuggestionRowProps {
  text: string;
  icon: string;
  display: ProofSuggestionDisplay;
  onPress: () => void;
}

type ProofSuggestionDisplay =
  | { kind: 'sat'; amount: number; unit: string }
  | { kind: 'fiat'; label: string };

export function getProofSuggestionDisplay(
  amount: number,
  unit: string,
  payload: Pick<ActionSheetPayloads['proof-selector'], 'displayMetadata'>
): ProofSuggestionDisplay {
  const metadata = payload.displayMetadata;
  if (metadata?.inputMode !== 'fiat') return { kind: 'sat', amount, unit };

  const fiat =
    metadata.displaySats === amount && metadata.displayFiat != null
      ? metadata.displayFiat
      : metadata.btcPrice > 0
        ? Math.round((amount / 100_000_000) * metadata.btcPrice * 100) / 100
        : null;

  if (fiat == null) return { kind: 'sat', amount, unit };
  return { kind: 'fiat', label: `${metadata.fiatSymbol ?? ''}${fiat.toFixed(2)}` };
}

export function submitProofSuggestion(
  machine: ActionSheetPayloads['proof-selector']['machine'],
  amount: number
): void {
  void machine.chooseProofs(amount);
}

function SuggestionRow({ text, icon, display, onPress }: SuggestionRowProps) {
  return (
    <Menu.Item onPress={onPress}>
      <HStack align="center" gap={10} style={{ flex: 1 }}>
        <Icon name={icon} size={20} />
        <View style={{ flex: 1 }}>
          {/* `flex: 0` + `numberOfLines={1}` neutralises heroui's baked-in
              `flex-1` on Menu.ItemTitle, which collapses to zero height
              outside a `Menu.Content` host. Same defence as `paymentOptionsSheet`. */}
          <Menu.ItemTitle className="flex-none" numberOfLines={1} style={{ flex: 0 }}>
            {text}
          </Menu.ItemTitle>
        </View>
        <View>
          {display.kind === 'fiat' ? (
            <Menu.ItemTitle className="flex-none" numberOfLines={1} style={{ flex: 0 }}>
              {display.label}
            </Menu.ItemTitle>
          ) : (
            <AmountFormatter
              amount={display.amount}
              unit={display.unit}
              size={16}
              weight="medium"
            />
          )}
        </View>
      </HStack>
    </Menu.Item>
  );
}

interface ProofSelectorContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['proof-selector'];
}

export function ProofSelectorContent({ payload, close }: ProofSelectorContentProps) {
  const { suggestions, unit, machine } = payload;

  return (
    <View>
      <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
        Choose amount
      </BottomSheet.Title>
      <Menu>
        {suggestions?.roundUp != null ? (
          <SuggestionRow
            text="Round up"
            icon="fluent:arrow-upload-16-filled"
            display={getProofSuggestionDisplay(suggestions.roundUp.amount, unit, payload)}
            onPress={() => {
              submitProofSuggestion(machine, suggestions.roundUp!.amount);
              close();
            }}
          />
        ) : null}
        {suggestions?.roundDown != null ? (
          <SuggestionRow
            text="Round down"
            icon="fluent:arrow-download-16-filled"
            display={getProofSuggestionDisplay(suggestions.roundDown.amount, unit, payload)}
            onPress={() => {
              submitProofSuggestion(machine, suggestions.roundDown!.amount);
              close();
            }}
          />
        ) : null}
        <View className="bg-foreground/10 mx-3 my-1 h-px" />
        <Menu.Item
          onPress={() => {
            void machine.requestMintSelector();
            close();
          }}>
          <HStack align="center" gap={10} style={{ flex: 1 }}>
            <Icon name="mdi:swap-horizontal" size={20} />
            <View style={{ flex: 1 }}>
              <Menu.ItemTitle className="flex-none" numberOfLines={1} style={{ flex: 0 }}>
                Change mint
              </Menu.ItemTitle>
            </View>
          </HStack>
        </Menu.Item>
      </Menu>
    </View>
  );
}

export function proofSelectorPopup(payload: ActionSheetPayloads['proof-selector']): void {
  showActionSheet('proof-selector', payload);
}
