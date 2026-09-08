# Security

Use distinct random gateway and admin secrets. Bind to loopback by default;
terminate HTTPS before exposing the service remotely. This is a trusted
single-workspace deployment, not a multi-tenant security boundary. Metadata
labels can be supplied by any gateway client and must not grant privileges.

Provider destinations are operator-configured HTTPS URLs (loopback HTTP for
local use). Redirects fail closed. Incoming credentials/headers are not relayed.
Only provider-specific credentials are sent upstream. Logs contain no inference
payloads or raw upstream errors.
to admin APIs are stored as supplied; do not put secrets in them.

Optional response caching retains content in process memory. SQLite files and
the data directory should remain private. Configuration paths and server plugins
must be trusted. Do not use a shared data directory across processes; the CLI
lock is a deliberate single-writer guard. Library embedders must enforce the
same ownership. Budget guards are estimates, not provider billing controls.

Report security issues privately to the project owner before public disclosure.
