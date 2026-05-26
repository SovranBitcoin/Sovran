---
layout: home

hero:
  name: Colada
  text: Cashu payment flow orchestration
  tagline: Parse, route, and execute payment flows — screens stay thin, the machine owns the rules.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Flows
      link: /flows/cashu-send

features:
  - title: Flow Machine
    details: State machine sequences scan → parse → amount → mint → execute. Handlers are navigation glue; operations are wallet I/O.
  - title: Screen Actions
    details: Typed per-button availability and loading for terminal screens. Screens call useScreenActions and render — no business logic.
  - title: Input Pipeline
    details: Normalize → detect → parse → annotate → resolve intent → guard. Handles BIP-321 containers, Lightning, Cashu tokens, payment requests, npubs.
  - title: QR Display
    details: Patterns for rendering static and animated QR codes — tokens, invoices, addresses. Tap-to-copy, fallbacks, and per-screen guidance.
    link: /guide/qr-display
  - title: Navigation Patterns
    details: Intent-based routing infers the correct flow from user actions — no protocol dropdowns. Scan is a first-class entry point.
    link: /guide/navigation-patterns
  - title: Success Feedback
    details: Terminal screen behavior, success animations, fee breakdowns, pending token tracking, and confirmation before execution.
    link: /guide/success-feedback
---
