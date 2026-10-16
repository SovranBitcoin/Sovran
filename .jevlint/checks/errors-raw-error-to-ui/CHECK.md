Where does raw upstream error text reach a user-visible surface?

Find where an Error.message, String(error), a caught value, a response body, err.detail or a
serialized error is passed to an Alert, toast, popup, sheet or rendered text. Also find
describeError in app/shared/lib/errors and the payment copy catalog, which are the correct route:
they map a failure onto wording chosen for a user. Passing an error to those or to a logger is
correct. App-authored messages, form validation messages, developer-only or __DEV__ screens and
tests are not concerns. The concern is a stack trace, HTTP body, mint or relay wording, or a
library's internal message shown as if it were app copy.
