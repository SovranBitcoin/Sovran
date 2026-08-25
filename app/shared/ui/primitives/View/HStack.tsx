import React from 'react';
import { Stack, StackProps } from './Stack';

type HStackProps = StackProps;

/**
 * Horizontal flex stack.
 *
 * `align` keeps its `'center'` default — that is a real choice, not Yoga's
 * (`'stretch'`), and every caller relies on it. `justify` and `wrap` had
 * defaults that merely restated Yoga's own, and because Uniwind renders
 * `style={[classNameStyle, props.style]}` — later wins in React Native — those
 * restatements silently overrode any `justify-*` or `flex-wrap` class a caller
 * passed. They are gone; Yoga applies the same values, and a className now
 * takes effect.
 *
 * An `items-*` class is still overridden by the `align` default. Pass the
 * `align` prop for that one.
 */
const HStack = React.forwardRef<any, HStackProps>((props, ref) => (
  <Stack ref={ref} direction="row" {...props} align={props.align ?? 'center'} />
));

HStack.displayName = 'HStack';

export { HStack };
