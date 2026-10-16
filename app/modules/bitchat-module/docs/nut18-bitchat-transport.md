# NUT-18 over Bitchat

The [nearby wallet wire contract](README.md) owns discovery, authenticated
capability exchange, private-message framing and payment delivery. The
[architecture decision](../../../docs/adr/0023-quiet-nearby-payments.md) records
the privacy and reachability tradeoffs.

New payments require the signed wallet capability and a P2PK lock. Native
favorites and raw token DMs are not the outgoing payment protocol. Stock clients
can route encrypted public-mesh traffic, but they are not wallet recipients.
