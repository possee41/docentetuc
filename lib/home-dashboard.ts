export type HomePriorityCandidate = {
  kind: "vacante" | "capacitacion" | "junta";
  registrationOpensAt?: string | null;
  eventAt?: string | null;
  matched: boolean;
  inAgenda: boolean;
  updatedAt: string;
};

const dayNumber = (value: string | Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return Date.UTC(number("year"), number("month") - 1, number("day")) / 86_400_000;
};

export const calendarDayDistance = (value: string | null | undefined, now: Date) => value ? dayNumber(value) - dayNumber(now) : null;

export const homePriority = (candidate: HomePriorityCandidate, now: Date) => {
  const openingDay = candidate.kind === "capacitacion" ? calendarDayDistance(candidate.registrationOpensAt, now) : null;
  if (openingDay === 0) return 0;
  if (openingDay === 1) return 1;
  if (openingDay !== null && openingDay > 1) return 2;
  if (candidate.kind === "vacante" && candidate.matched) return 3;
  if (candidate.inAgenda) return 4;
  return candidate.matched ? 5 : 6;
};

export const compareHomePriority = (left: HomePriorityCandidate, right: HomePriorityCandidate, now: Date) => {
  const rank = homePriority(left, now) - homePriority(right, now);
  if (rank) return rank;
  const leftDate = Date.parse(left.registrationOpensAt || left.eventAt || "") || Number.MAX_SAFE_INTEGER;
  const rightDate = Date.parse(right.registrationOpensAt || right.eventAt || "") || Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
};

