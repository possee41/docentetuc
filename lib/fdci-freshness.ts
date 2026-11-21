// One daily run plus a small scheduling margin. A missed run stops current claims.
export const FDCI_FRESHNESS_MS = 27 * 60 * 60_000;
export const FDCI_CURRENT_SQL = `EXISTS (SELECT 1 FROM fdci_import_checkpoint c WHERE c.id=1
  AND c.upper_key='' AND c.last_cycle_status='OK'
  AND datetime(c.last_completed_at)<=datetime('now')
  AND datetime(c.last_completed_at)>=datetime(?,'-27 hours'))`;

export function fdciPublicationFresh(lastSeen: string | null | undefined, now = new Date()) {
  const seen = lastSeen ? Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(lastSeen) ? lastSeen : `${lastSeen.replace(" ", "T")}Z`) : NaN;
  return Number.isFinite(seen) && seen <= now.getTime() && now.getTime() - seen <= FDCI_FRESHNESS_MS;
}
