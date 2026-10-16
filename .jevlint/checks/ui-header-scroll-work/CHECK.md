Where does a scroll or header handoff callback write React state or rebuild navigator options?

Find scroll handlers, the state they set, the components that read that state, and any
navigation.setOptions call made while scrolling. The concern is header-only visual animation
rerendering a whole page or repeatedly updating the navigator. A shared UI-thread animation, an
isolated development probe, and list or media offset bookkeeping are allowed. Look for actual
state writes, not missed memoization.
