Where can retry or concurrent re-entry execute the same intended payment or spend a second time?

Find each retry, resend and re-entry path around melt, swap, send and pay, and the identity,
deduplication, in-flight or state guard that stops a repeat. Only a payment or spend effect counts:
relay publication and ordinary repeated I/O do not. A potentially committed spend must not be
retried as a new operation; a retry that reuses the operation's identity is correct.
