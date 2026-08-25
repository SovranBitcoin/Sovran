import React from 'react';
import { Stack, StackProps } from './Stack';

type VStackProps = StackProps;

/**
 * Vertical flex stack.
 *
 * `align` / `justify` / `wrap` deliberately have **no defaults**. They used to
 * default to `'stretch'` / `'flex-start'` / `'nowrap'` — which are Yoga's own
 * defaults, so writing them changed nothing visually, but it did put a concrete
 * value into the `style` object on every render. Uniwind renders
 * `style={[classNameStyle, props.style]}`, and later entries win in React
 * Native, so those restated defaults silently overrode any `items-*`,
 * `justify-*` or `flex-wrap` class a caller passed. Leaving them undefined lets
 * Yoga apply the same defaults *and* lets a className take effect.
 */
const VStack = React.forwardRef<any, VStackProps>((props, ref) => (
  <Stack ref={ref} direction="column" {...props} />
));

VStack.displayName = 'VStack';

export { VStack };
