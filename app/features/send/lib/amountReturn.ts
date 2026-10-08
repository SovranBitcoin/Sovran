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

interface NavRoute {
  name: string;
  state?: NavState;
}

interface NavState {
  index?: number;
  routes: readonly NavRoute[];
}

export type AmountFlowGroup = '(send-flow)' | '(receive-flow)';

export function isMintPickerOverAmount(
  root: NavState | undefined,
  flowGroup: AmountFlowGroup
): boolean {
  let state = root;
  // Walk down the focused route of each navigator until the flow's stack.
  while (state) {
    const active = state.routes[state.index ?? state.routes.length - 1];
    if (!active) return false;
    if (active.name === flowGroup) {
      const stack = active.state;
      if (!stack) return false;
      const index = stack.index ?? stack.routes.length - 1;
      return (
        index > 0 &&
        stack.routes[index]?.name === 'mintSelect' &&
        stack.routes[index - 1]?.name === 'amount'
      );
    }
    state = active.state;
  }
  return false;
}
