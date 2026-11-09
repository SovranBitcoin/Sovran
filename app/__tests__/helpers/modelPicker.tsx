/**
 * The AI model picker as the picker sheet would show it, read from the
 * Routstr store: its tabs, the tab it opens on, and that tab's rows. The
 * sheet's own drawing is covered by `pickerSheet.test.tsx`.
 */

import TestRenderer, { act } from 'react-test-renderer';

import { modelPickerRequest, modelPickerState } from '@/features/ai/lib/modelPickerRequest';
import type { PickerOption, PickerRequest, PickerSection } from '@/shared/lib/picker/types';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

export interface OpenModelPicker {
  request: PickerRequest;
  /** The tab the sheet opens on. */
  openTab: PickerSection | undefined;
  tab: (providerId: string) => PickerSection | undefined;
  /** A row in any tab, by testID. */
  row: (testID: string) => PickerOption;
  /** What a tab's rows say, as one searchable string (the open tab by default). */
  copy: (providerId?: string) => string;
  /** A row's trailing slot, rendered. */
  trailing: (testID: string) => TestRenderer.ReactTestRenderer | null;
}

export function openModelPicker(balanceSats = 10_000): OpenModelPicker {
  const request = modelPickerRequest(modelPickerState(useRoutstrStore.getState(), balanceSats));
  const sections = request.sections ?? [];
  const openTab =
    sections.find((section) => section.id === request.initialSectionId) ??
    sections.find((section) => section.options.some((option) => option.selected)) ??
    sections[0];
  const tab = (providerId: string) => sections.find((section) => section.id === providerId);
  const row = (testID: string) => {
    const found = sections
      .flatMap((section) => section.options)
      .find((option) => option.testID === testID);
    if (!found) throw new Error(`no row ${testID}`);
    return found;
  };
  const trailing = (testID: string) => {
    const node = row(testID).trailing;
    if (node == null) return null;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<>{node}</>);
    });
    return tree;
  };
  const copy = (providerId?: string) => {
    const shown = providerId ? tab(providerId) : openTab;
    return JSON.stringify(
      (shown?.options ?? []).map((option) => [
        option.title,
        option.description,
        option.reason,
        option.trailing == null ? null : trailing(option.testID)?.toJSON(),
      ])
    );
  };
  return { request, openTab, tab, row, copy, trailing };
}
