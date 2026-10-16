/**
 * A touch layer says, in the log, that a touch arrived and that it lifted.
 *
 * The end-to-end runner sends a touch from outside the app and cannot know
 * when the app received it. It waits for these two entries before asking
 * whether the screen has settled.
 */
import { render, screen } from '@testing-library/react-native';

import { log } from '@/shared/lib/logger';
import { TouchIndicatorEnabled, TouchIndicatorLayer } from '@/shared/ui/composed/TouchIndicator';

type Handlers = { onTouchStart: (event: unknown) => void; onTouchEnd: (event: unknown) => void };

/** The touch layers on screen, outermost first. */
const layers = (): Handlers[] =>
  screen.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onTouchStart === 'function'
  ).map((node) => node.props as Handlers);

const touch = (identifier: number, pageX: number, pageY: number) => ({
  nativeEvent: { identifier, timestamp: 1000 + identifier, pageX, pageY },
});

describe('touch layer logging', () => {
  let debug: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(log, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const touchEntries = () => debug.mock.calls.filter(([event]) => event === 'ui.touch');

  it('logs where a touch landed and that it lifted', () => {
    render(
      <TouchIndicatorEnabled.Provider value>
        <TouchIndicatorLayer>
          <></>
        </TouchIndicatorLayer>
      </TouchIndicatorEnabled.Provider>
    );

    const [layer] = layers();
    layer.onTouchStart(touch(1, 120, 640));
    layer.onTouchEnd(touch(1, 120, 640));

    expect(touchEntries()).toEqual([
      ['ui.touch', { phase: 'start', x: 120, y: 640 }],
      ['ui.touch', { phase: 'end' }],
    ]);
  });

  it('logs one touch once when layers are nested', () => {
    render(
      <TouchIndicatorEnabled.Provider value>
        <TouchIndicatorLayer>
          <TouchIndicatorLayer>
            <></>
          </TouchIndicatorLayer>
        </TouchIndicatorLayer>
      </TouchIndicatorEnabled.Provider>
    );

    // A touch bubbles through every layer, innermost first.
    const [outer, inner] = layers();
    const event = touch(2, 10, 20);
    inner.onTouchStart(event);
    outer.onTouchStart(event);

    expect(touchEntries()).toEqual([['ui.touch', { phase: 'start', x: 10, y: 20 }]]);
  });

  it('logs nothing while touches are not being drawn', () => {
    render(
      <TouchIndicatorLayer>
        <></>
      </TouchIndicatorLayer>
    );

    expect(layers()).toEqual([]);
    expect(touchEntries()).toEqual([]);
  });
});
