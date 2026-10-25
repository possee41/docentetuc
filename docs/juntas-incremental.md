# Juntas incremental (DocenteTuc 1.2)

The Node runner is opt-in. The existing Juntas workflow and production Cron are unchanged.
Apply `migrations/0026_juntas_incremental.sql` only to an isolated D1 before a controlled source run. The migration adds two tables and does not update publications.

- `juntas_import_checkpoint` stores one lease, folder queue, page token, position within a page, last completed crawl, and error per configured root.
- `juntas_import_applied` stores the metadata signature of a Drive file only after all publications extracted from it have been applied. A failed checkpoint write may replay a file; publication hashes make that replay idempotent.
- Google Docs roots retain the hash of the last completed text and an item index. An interrupted changed document may be fetched again, but previously applied notices are not duplicated.
- A Drive page token rejected as expired restarts only that folder. Files with a confirmed signature are skipped.
- A completed traversal is **not** a consistent Drive snapshot. This runner never removes or expires a publication based on an absent listing.

The test runner has per-invocation limits for source requests and publication attempts. `JUNTAS_MAX_REQUESTS` defaults to 25 and `JUNTAS_MAX_PUBLICATION_WRITES` to 20; control writes for leases/checkpoints are additional and measured separately. A completed root is not rescanned for 24 hours by default. There is no automatic schedule.

For a later canary-only trial, `scripts/import-direct-d1.mjs` accepts `SYNC_SOURCE=juntas`, `JUNTAS_SCOPE=checkpoint`, and an optional configured `JUNTAS_ROOT_ID`. Its database UUID is fixed to the canary and it checks that database's identity before writing. Set a small request budget for the first official run. Never put the Drive key or D1 token in a command argument, file, or log. The D1 REST client spaces requests by at least 350 ms in this mode.

Local synthetic checks:

```powershell
node --experimental-strip-types --test scripts/import-juntas-checkpoint.test.mjs
node --experimental-strip-types scripts/bench-juntas-checkpoint-local.mjs --records=100
```

Before activation, verify the new migration in the selected isolated D1, run one root with a small budget, inspect category `PARTIAL`/`OK` and D1 metrics, and confirm the legacy writer is disabled for that source. The first full import, a real Drive update cycle, REST account rate limits, and the cutover still need controlled verification.
