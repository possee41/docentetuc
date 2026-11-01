# FDCI gateway runner 1.2 — isolated release

This release adds only the manual workflow and its self-contained Node runner.
It does not change the web, existing workflows, source modules, Workers or D1.

- Source revision: `87b8efcf0d69537c1ba8730cd1ecebd4039198ac`.
- `import-gate.mjs`: readable ESM bundle, Node 22+, built with existing esbuild
  0.27.3; no npm install, external packages, credentials or environment files.
- `manifest.json`: original input hashes and bundle SHA-256. Only FDCI dispatch
  is retained; other sources fail closed. FDCI authentication, matching of the
  approved SHA, owner, 600-second lease, incremental cursor and ACK logic are reused.
- Packaging regression: 10/10 existing gate/job tests passed against the bundle,
  using synthetic source responses and local SQLite. No live import performed.

## Disabled publication

New workflow: `.github/workflows/fdci-gateway-import.yml`. Old workflow ID
390697556 (`fdci-import.yml`) must remain disabled; do not delete or enable it.
The new workflow has only `workflow_dispatch`, no active schedule/push/PR trigger.
It must be disabled in GitHub after registration, and its job additionally requires
`FDCI_WORKFLOW_ENABLED=true`. Concurrency group stays `fdci-import`.

Future manual dispatch is limited to the default branch. Set `FDCI_IMPORT_REF`
and `FDCI_IMPORT_APPROVED_SHA` to the same separately approved full SHA containing
this release, then verify actual checkout HEAD. Do not use a branch name or the
unpublished source revision as the executable SHA. All preflight authorization
checks still apply. Production target, exact gateway origin and database identity
must be configured in environment `fdci-pilot`.

The future secret `FDCI_IMPORT_SECRET` must exist only in that protected GitHub
Actions environment and the authorized FDCI gateway. Do not use a Cloudflare or
D1 Edit token in Actions. Creating/rotating secrets, arming the gateway, enabling
this workflow and dispatching it each require express authorization; none occurs
by committing this release.

## Future run and shutdown

Limits: 2 examined commissions/publications, 6 official requests, 400 ms pauses,
active scope, 600-second lease, one publication per gateway HTTP. Open/import/
checkpoint/close use one owner. Persistent cursor continues on the next authorized
run. Mutations are not retried after ambiguous responses. Finally plus the
workflow always-cleanup close the owner's lease; expiration is the fallback if
GitHub terminates execution. No push delivery or notification materialization.

A failed job does not disable later scheduled runs. Keep scheduling absent until
one separately authorized manual Actions run passes. Stop further runs on 1102,
D1/owner/identity errors, uncertain ACK or observed individual CPU >7 ms; a low
p99 is not a proven maximum. Observe metrics without broadening permissions.

Emergency stop independent of GitHub: restore the gateway's existing closed
configuration (enabled=false, lease_required=false, allowed_source=fdci,
fdci_external=false), verify 503 open/import/checkpoint, drain admitted requests,
check no live leases and retire only the FDCI secret. No automatic D1 restore.
This release does not change or execute that procedure.
