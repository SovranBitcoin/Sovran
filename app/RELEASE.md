# Releases

Production releases are coordinated by the GitHub **Production release** workflow.
See [the release setup and operator guide](../release/README.md) for credentials,
signing checks, the disabled-by-default activation procedure and retry behavior.

`build:ios` and `build:android` are build-only manual diagnostics. They no longer
update dependencies or automatically submit. They are not the publication path.
The old local Freedom Store CLI and separate EAS APK profile have been removed.

Development clients still use `build:dev:ios` / `build:dev:android`.
