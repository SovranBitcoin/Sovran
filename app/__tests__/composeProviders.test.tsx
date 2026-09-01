import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { compose } from '@/shared/lib/utils';

/**
 * `compose` nests the app's provider stack. Its contract is narrow but the
 * blast radius is the whole app: every provider below a broken entry — relay
 * sockets, wallet, price feed — is remounted when the wrapper's identity is
 * unstable, and nothing else in the tree would report it.
 */
describe('compose', () => {
  function trackingProvider(tag: string, mounts: string[]) {
    return function TrackingProvider({ children }: { children: React.ReactNode }) {
      React.useEffect(() => {
        mounts.push(tag);
      }, []);
      return <>{children}</>;
    };
  }

  it('nests providers with the first entry outermost', () => {
    const order: string[] = [];
    function Outer({ children }: { children: React.ReactNode }) {
      order.push('outer');
      return <>{children}</>;
    }
    function Inner({ children }: { children: React.ReactNode }) {
      order.push('inner');
      return <>{children}</>;
    }

    const Composed = compose([Outer, Inner]);
    const view = render(
      <Composed>
        <Text>leaf</Text>
      </Composed>
    );

    expect(order).toEqual(['outer', 'inner']);
    view.unmount();
  });

  it('passes tuple props to the configured provider', () => {
    const seen: string[] = [];
    function Configured({ children, tag }: { children: React.ReactNode; tag: string }) {
      seen.push(tag);
      return <>{children}</>;
    }

    const Composed = compose([[Configured, { tag: 'account-3' }]]);
    const view = render(
      <Composed>
        <Text>leaf</Text>
      </Composed>
    );

    expect(seen).toEqual(['account-3']);
    view.unmount();
  });

  it('does not remount providers when the owning component re-renders', () => {
    const mounts: string[] = [];
    const Direct = trackingProvider('direct', mounts);
    function Configured({ children }: { children: React.ReactNode; tag: string }) {
      return <>{children}</>;
    }
    const Tracked = trackingProvider('configured', mounts);
    function ConfiguredTracked({ children, tag }: { children: React.ReactNode; tag: string }) {
      return (
        <Configured tag={tag}>
          <Tracked>{children}</Tracked>
        </Configured>
      );
    }

    const Composed = compose([[ConfiguredTracked, { tag: 'a' }], Direct]);
    function Owner({ tick }: { tick: number }) {
      return (
        <Composed>
          <Text>{tick}</Text>
        </Composed>
      );
    }

    const view = render(<Owner tick={1} />);
    view.rerender(<Owner tick={2} />);
    view.rerender(<Owner tick={3} />);

    // One mount each — a re-created wrapper type would push a second and third.
    expect(mounts).toEqual(['direct', 'configured']);
    view.unmount();
  });
});
