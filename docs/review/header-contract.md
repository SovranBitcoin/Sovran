# Navigation headers

Standard pages use a transparent navigation bar over the shared `Screen` gradient.
`GRADIENT_HEADER_OPTIONS` disables native blur, solid fills, shadows and the
iOS 26 automatic top scroll-edge effect. The navigator owns header height; `Screen` owns the page fade and scroll clearance.
The entire fade, including its iOS blur mask, ends within that clearance: at
scroll zero it must not cover the first row or any pinned selectors.
Android form sheets use `FlowSheetHeader`, which owns their gradient and grabber.
Never add a second header background over that custom header.

An identity page uses `useIdentityHeader` and `IdentityHeader`. The page avatar
hands off to the compact header identity as it crosses the header: icon above name,
the whole stack inside the header-button box (`headerIdentity` tokens), so it shares
the actions' row and never outgrows the bar. A mint identity (`kind: 'mint'`) draws
`MintIcon` and its placeholder. Connected Apps, mint details, profiles, recipient
payments, direct messages and threads share this identity.
Long names truncate; title content fits in one navigation row.

A title stays on the screen's centre line only while it clears the busier side
mirrored onto both. Native bars slide a wider title toward the emptier side, so a
custom title bounds itself with `useCenteredTitleMaxWidth(sideActions)`, and
`FlowSheetHeader` gives both side slots the wider side's measured width. Amount entry puts
mint selection in its existing bottom action slot, with its payment constraints intact.
A plain title remains appropriate when no identity is known or the page does not scroll.

Receive's pinned selectors use opaque chrome, continuous with their solid tab band.
Receive and custom fixed-filter lists (Feed, Contacts, Notifications) declare
`headerAppearance="opaque"`. Other scrolling pages retain the bounded gradient.
This is a supported variant, not an exception implemented with native header colors.

Persistent section selectors, including Receive's rail and Lightning mode tabs,
use `Screen.stickyContent`. Its measured height reserves scroll clearance. Custom
scrollers use `Screen safeArea="scroll"` with `ScreenScrollView` or `List screen`.
Their header clearance belongs in scroll content, so rows can move behind the
fade. A fixed `safeArea` frame is reserved for pinned-filter/non-scrolling layouts;
placing an ordinary page scroller inside it leaves the header looking permanently
solid. Safe-area and navigation insets are applied once.
Full-bleed profile banners reveal the gradient after the identity leaves the page.
Camera, stories and other deliberately immersive media may omit the gradient/header.

Examples: Settings → Design system → Headers. Native scenario: `settings.headers`.
Verify top, threshold, reverse scroll, long names, missing images, reduced motion,
and large text on iOS and Android. Static gates do not establish native appearance.

The deterministic glass-header gate owns forbidden opaque header options. Hunch
reviews behavior across layout and scroll ownership, not the presence of an API.


Horizontal currency/month strips use `headerAppearance="gradient-tabs"`: one
fade spans the measured navigation bar plus tab band. The strip container is
transparent; its controls sit above the fade and remain interactive. Body content
starts below the full band at rest and may move behind the tabs while scrolling.
Android's custom sheet header delegates this combined background to Screen so
there is only one fade. Receive's underlined rail tabs keep their solid variant.

Identity activation follows the measured full identity section, not just the
avatar edge. Header-only visual state stays in Reanimated; a handoff must not
rerender the owning profile, mint or thread page. Development probes may update
in isolation. Custom media lists retain their required offset bookkeeping.
Render-count tests establish avoidable React work; FPS claims require device profiling.
