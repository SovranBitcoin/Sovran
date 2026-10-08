/**
 * @fileoverview The wallet home's actions, as data.
 *
 * Every home layout arranges the same actions; none of them owns what an
 * action does. `WalletScreen` builds this record once (it holds the payment
 * machine and the active unit) and hands it to whichever layout the active
 * style names. A layout that needs a new arrangement never touches a handler,
 * and a new action is available to every layout at once.
 */

import type React from 'react';

export type HomeActionId =
  | 'receive'
  | 'send'
  | 'scan'
  | 'split'
  | 'theme'
  | 'history'
  | 'map'
  /** The overflow control a layout builds for itself; never in `HomeActions`. */
  | 'more';

export interface HomeAction {
  readonly id: HomeActionId;
  /** Short caption shown on the control. */
  readonly label: string;
  /** Longer label for a menu row, where there is room for it. */
  readonly menuText?: string;
  readonly description?: string;
  /** Monicon name. */
  readonly icon: string;
  /** SF Symbol for the liquid-glass controls on iPhone. */
  readonly systemIcon?: string;
  /** Stable e2e selector. Identical in every layout. */
  readonly testID: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

export type HomeActions = Readonly<Record<Exclude<HomeActionId, 'more'>, HomeAction>>;

export interface HomeLayoutProps {
  readonly actions: HomeActions;
  /**
   * The balance carousel. `floorScale` scales the phone-proportional minimum
   * height the carousel reserves: 1 is the roomy original, 0 lets the balance
   * take only the height of its own content.
   */
  readonly renderBalance: (floorScale: number) => React.ReactElement;
  /** A multi-leg swap is running: payment actions are inert. */
  readonly paymentsLocked: boolean;
}
