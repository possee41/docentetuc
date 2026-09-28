export function notificationDedupeKey(publicationId: string, eventType: string, eventIdentity: string) {
  return `publication:${publicationId}:${eventType}:${eventIdentity}`.slice(0, 255);
}
