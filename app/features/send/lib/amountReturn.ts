/**
 * Is the mint picker sitting on top of the amount screen that opened it?
 *
 * The picker is reached two ways. As the FIRST screen of a flow there is
 * nothing under it, and choosing a mint goes forward to the amount screen.
 * Opened FROM the amount screen (a sheet over it on iPhone, a page pushed
 * after it on Android), choosing a mint has to come back to that same screen
 * with the new mint: navigating forward again stacked a second amount screen
 * on top of the picker.
 *
 * The machine cannot tell the two apart (same step, same scope), and
 * `canGoBack()` is true for both whenever anything at all precedes the flow.
 * What tells them apart is the flow's own stack: the route directly beneath
 * the current picker.
 */

import { Platform } from 'react-native';

/**
 * Whether a picker opened over another screen is a system sheet (iPhone) or a
 * page pushed after it (Android, ADR 0025). The stack presents every screen
 * that follows a sheet as a modal over it, so a sheet cannot be navigated
 * past; a page can.
 */
export const mintPickerIsSheet = () => Platform.OS === 'ios';

interface NavRoute {
  name: string;
  state?: NavState;
}

interface NavState {
  index?: number;
  routes: readonly NavRoute[];
}

export type AmountFlowGroup = '(send-flow)' | '(receive-flow)';

/**
 * What sits directly beneath the mint picker, when the picker is the flow's
 * current screen and has something beneath it: the amount screen that opened
 * it, or another screen (the hub it follows, a preview whose mint pill opened
 * it). Null when the picker is not on top, or is the flow's first screen.
 */
export function mintPickerUnderlay(
  root: NavState | undefined,
  flowGroup: AmountFlowGroup
): 'amount' | 'other' | null {
  let state = root;
  // Walk down the focused route of each navigator until the flow's stack.
  while (state) {
    const active = state.routes[state.index ?? state.routes.length - 1];
    if (!active) return null;
    if (active.name === flowGroup) {
      const stack = active.state;
      if (!stack) return null;
      const index = stack.index ?? stack.routes.length - 1;
      if (index === 0 || stack.routes[index]?.name !== 'mintSelect') return null;
      return stack.routes[index - 1]?.name === 'amount' ? 'amount' : 'other';
    }
    state = active.state;
  }
  return null;
}

export function isMintPickerOverAmount(
  root: NavState | undefined,
  flowGroup: AmountFlowGroup
): boolean {
  return mintPickerUnderlay(root, flowGroup) === 'amount';
}
