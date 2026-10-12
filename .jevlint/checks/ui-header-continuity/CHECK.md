Where do screens wire a shared header to their scrolling content: identity handoff, inset ownership, pinned section selectors and the header gradient?

Find the header components, the scroll views that feed them and the screens that combine both.
The contract: a page identity is neither duplicated nor lost during its scroll handoff; header
actions and content are not hidden by a wrong inset owner; a section selector stays reachable while
its content scrolls; no fixed inset stops content entering the gradient header; no opaque strip
breaks the combined header and tab gradient; handoff starts only after the measured identity
section clears navigation. Using a header API without one of these failures is not a concern.
