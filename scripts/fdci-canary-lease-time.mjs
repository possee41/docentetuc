// Compare times issued by the same Worker clock, then keep a monotonic
// deadline starting before the opening request. Reserve 30 s for closure.
export function canaryLeaseDeadline(ack, sentAtMs, receivedAtMs, requestedSeconds) {
  const duration = Date.parse(ack?.expiresAt) - Date.parse(ack?.openedAt);
  const requestedMs = requestedSeconds * 1000;
  if (!Number.isInteger(requestedSeconds) || requestedSeconds < 60 || requestedSeconds > 600 ||
      !Number.isFinite(duration) || duration <= 0 || duration >= requestedMs + 1_000 ||
      !Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs) ||
      sentAtMs > receivedAtMs) throw Error("LEASE_TIME_INVALID");
  // The gateway samples Date.now() twice. Its second stamp can be a few ms
  // later; use at most the requested TTL even when the stamps differ.
  const deadline = sentAtMs + Math.min(duration, requestedMs) - 30_000;
  if (receivedAtMs >= deadline) throw Error("LEASE_CLOSURE_MARGIN_EXHAUSTED");
  return deadline;
}
