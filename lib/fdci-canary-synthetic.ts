// Exact fixtures from the 2026-11-01 durable-cursor canary, not an official ID range.
// Provenance: docs/1.2-fdci-cursor-canary-resumed-2026-11-01.md, same D1 UUID.
export const FDCI_CANARY_SYNTHETIC_IDS = [
  "fdci:commission:980000001", "fdci:commission:980000002", "fdci:commission:980000003",
  "fdci:commission:980000004", "fdci:commission:980000005",
] as const;
const syntheticIds = new Set<string>(FDCI_CANARY_SYNTHETIC_IDS);
export const isKnownFdciSynthetic = (id: string) => syntheticIds.has(id);
// Only developer-controlled constants are interpolated; request values remain bound parameters.
// Scalar comparisons avoid NOT IN's ephemeral lookup reads in local D1; no new index/query.
export const EXCLUDE_FDCI_CANARY_SYNTHETIC_SQL = FDCI_CANARY_SYNTHETIC_IDS.map(id => `id <> '${id}'`).join(" AND ");
