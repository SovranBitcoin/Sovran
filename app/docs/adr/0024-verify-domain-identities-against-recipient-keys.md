# 24. A domain identity verifies a key mapping, not a person

Date: 2026-10-03
Status: Accepted

A nearby device proves control of its transport and payment keys through the
[nearby capability](0023-quiet-nearby-payments.md). Its profile name, picture and
claimed NIP-05 address remain self-assertions. A payment always retains its
selected key; a domain lookup must never replace the destination.

[NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) supplies an
independent domain-to-key check. The shared wallet resolver rejects redirects,
malformed responses and conflicting case variants. It bounds the request and
body-read deadline, caps streamed bodies, and checks the exact selected public
key. Transports without streaming can only cap accepted buffered text.

Presentation attaches a blue check to the matching address, never to the name
or avatar. A failed or mismatched lookup is red and names the failed check;
pending is neutral. Selected payment screens also retain the public key.
This does not prove a real-world identity, a trustworthy domain, or that a person
is the intended recipient. A domain controlled by an attacker can correctly
verify that attacker's key.

The app shares short-lived verification by address **and** key, with bounded
concurrency and storage. Nearby profile warm-up also warms these checks.
Domain endpoints learn that their identifiers were looked up; this is not
anonymous discovery. Offline or suspended applications cannot guarantee a warm
or current result. Provider-supplied validity flags never establish trust.

Saving a changed, nonempty own NIP-05 claim requires a fresh check at the
publishing boundary before signing. Clearing a claim remains possible. Unrelated
profile edits do not require an existing claim to remain reachable.

The npub.cash shortcut reads an existing account username and verifies its
public mapping. It never registers or buys a name. Its automatic npub Lightning
address is not evidence of NIP-05 support: the
[provider API](https://docs.npub.cash/api-reference.html) documents purchased
usernames separately from LNURL addresses.

Device layout, accessibility, native redirect handling and real-domain success
remain subject to the verification boundary in
[F59](../../../docs/architecture/follow-ups.md).
