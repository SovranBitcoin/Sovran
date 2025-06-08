# Tests

This is a collection of things to add tests for that might not be tested yet.

- LUD16: When paying a LUD16 url, let's try to figure out the nostr identity either by checking if its npub@..., or by checking domain.com/.well-known/lnurlp/username. We should be showing their nostr pfp, and if we haven't seen that user before fetch their account, otherwise fallback to showing a generic send icon.
- When redeeming ecash via DMs, lets pass the npub to the transaction so we can show the nostr pfp.
