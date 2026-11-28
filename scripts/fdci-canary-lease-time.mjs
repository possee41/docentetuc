// Compare times issued by the same Worker clock, then keep a monotonic
// deadline starting before the opening request. Reserve 30 s for closure.
export function canaryLeaseDeadline(ack, sentAtMs, receivedAtMs, requestedSeconds) {
  const duration = Date.parse(ack?.expiresAt) - Date.parse(ack?.openedAt);
  if (!Number.isInteger(requestedSeconds) || requestedSeconds < 60 || requestedSeconds > 600 ||
      !Number.isFinite(duration) || duration <= 0 || duration > 600_000 ||
      duration > requestedSeconds * 1000 ||
      !Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs) ||
      sentAtMs > receivedAtMs) throw Error("LEASE_TIME_INVALID");
  const deadline = sentAtMs + duration - 30_000;
  if (receivedAtMs >= deadline) throw Error("LEASE_CLOSURE_MARGIN_EXHAUSTED");
  return deadline;
}
