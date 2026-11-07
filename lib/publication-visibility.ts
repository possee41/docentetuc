import { EXCLUDE_FDCI_CANARY_SYNTHETIC_SQL, isKnownFdciSynthetic } from "./fdci-canary-synthetic.ts";

// Boolean true, numeric 1 and their canonical string equivalents; never general truthiness.
const enabled = (value: unknown) => value === true || value === 1 || value === "true" || value === "1";

// Public discovery only. Private references and administrative queries retain their own authorization.
export function isPublicPublication(item: { id: string; metadata?: string | null }) {
  if (isKnownFdciSynthetic(item.id)) return false;
  try {
    const metadata = JSON.parse(item.metadata || "null");
    return !enabled(metadata?.preview) && !enabled(metadata?.catalogOnly);
  } catch { return true; } // Unknown/broken metadata is not proof that legitimate data is a fixture.
}

// CASE extracts each flag once and guards malformed JSON. No ephemeral IN table or new query.
export const PUBLICATION_VISIBILITY_SQL = `(${EXCLUDE_FDCI_CANARY_SYNTHETIC_SQL}) AND
  (CASE WHEN json_valid(metadata) THEN
    (CASE json_extract(metadata,'$.preview') WHEN 1 THEN 0 WHEN 'true' THEN 0 WHEN '1' THEN 0 ELSE 1 END)
    AND (CASE json_extract(metadata,'$.catalogOnly') WHEN 1 THEN 0 WHEN 'true' THEN 0 WHEN '1' THEN 0 ELSE 1 END)
  ELSE 1 END)`;
