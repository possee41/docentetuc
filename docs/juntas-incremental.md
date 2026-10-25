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

### Single-folder local probe (manual)

`scripts/probe-juntas-checkpoint-local.mjs` is fixed to `abiertos-primaria`. It uses a persistent Miniflare D1 under `.wrangler/juntas-checkpoint-probe`, applies the isolated publication schema and `0026`, and never uses a Cloudflare token. `--prepare` and `--status` do not contact Google. `--run` requires `GOOGLE_DRIVE_API_KEY` in the same PowerShell session and caps each invocation at five source requests and ten publication attempts. No schedule invokes it.

```powershell
Set-Location 'C:\Users\joaquin\Documents\Codex\DocenteTuc-1.2-sync-integration'
node --experimental-strip-types .\scripts\probe-juntas-checkpoint-local.mjs --prepare
node --experimental-strip-types .\scripts\probe-juntas-checkpoint-local.mjs --status
# Load GOOGLE_DRIVE_API_KEY privately in this PowerShell before either --run.
node --experimental-strip-types .\scripts\probe-juntas-checkpoint-local.mjs --run
node --experimental-strip-types .\scripts\probe-juntas-checkpoint-local.mjs --run
```

Each `--run` prints request and file counts, publication changes, actual local D1 row metrics, and a redacted checkpoint summary. It never prints the Drive key, resource keys, page tokens, document text, or publication content. The second command resumes from the same local database. A single root does not mark the entire Llamados category healthy. A Drive folder name alone never verifies an open call; `verifiedCurrentCallsInSample` uses the same strict board filter as the app and covers only the bounded sample reported alongside it.

When broad runs discover only folders, use `--status` to confirm `visitedFolders` rises and `visitedPendingOverlap` stays zero. A separately authorized `--focal-run` checks the first page of **at most three pending folders** for a real file. If none contains a file, it stops without changing the checkpoint. If one does, it moves that folder to the front under the existing lease, then processes **one folder step**. Discovery and processing together make at most five official requests and ten publication attempts; the rest of the queue remains intact. The focused command is intentionally manual:

```powershell
node --experimental-strip-types .\scripts\probe-juntas-checkpoint-local.mjs --focal-run
```

If those three pages contain only subfolders, the command reports `nextOffset` and leaves the checkpoint untouched. A later, separately approved run can use `--focal-run --offset=3` to inspect the next three pending folders without repeating the same requests. The offset is never advanced automatically.

The focal run can prove a real document is incorporated. A repeat without source changes proves idempotence in the synthetic test; an actual update requires the official file to change and must not be claimed from an unchanged second read.

Before activation, verify the new migration in the selected isolated D1, run one root with a small budget, inspect category `PARTIAL`/`OK` and D1 metrics, and confirm the legacy writer is disabled for that source. The first full import, a real Drive update cycle, REST account rate limits, and the cutover still need controlled verification.
