// Workers Logs correlation is supporting evidence only. It must never block
// materialization when the mandatory version checks have already passed.
export function evaluateAuthVersionEvidence({ mandatoryChecksPassed, tailEvent, enabledVersion }) {
  if (mandatoryChecksPassed !== true) throw new Error("MANDATORY_CHECKS_INCOMPLETE");
  if (!tailEvent) return { effectiveVersionVerified: false, reason: "LOGS_UNAVAILABLE" };
  if (tailEvent?.scriptVersion?.id !== enabledVersion) throw new Error("HTTP_ACTIVE_VERSION_MISMATCH");
  if (tailEvent?.event?.response?.status !== 401) throw new Error("UNEXPECTED_HTTP_STATUS");
  if (tailEvent?.outcome !== "ok") throw new Error("UNEXPECTED_OUTCOME");
  return { effectiveVersionVerified: true, reason: null };
}
