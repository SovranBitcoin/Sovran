Where can a validated payment request lose its amount, unit, mint or locking constraint on the way to execution?

Find where payment requests are parsed and validated, each step that carries them to the
operation that executes the payment, and the tests. A mintsPreferred list is advisory:
defaultOperations.ts may remove mints from an SDK input copy while keeping the original request
as flow identity. wallet/src/payment-request.ts returning null for an undecodable or unsupported
request is not a hidden failure.
