export type HomePriorityCandidate = {
  kind: "vacante" | "capacitacion" | "junta";
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  eventAt?: string | null;
  matched: boolean;
  inAgenda: boolean;
  updatedAt: string;
  matchScore?: number;
};

const dayNumber = (value: string | Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return Date.UTC(number("year"), number("month") - 1, number("day")) / 86_400_000;
};

export const calendarDayDistance = (value: string | null | undefined, now: Date) => value ? dayNumber(value) - dayNumber(now) : null;

export type RegistrationState = "today" | "tomorrow" | "two-three" | "four-seven" | "eight-fourteen" | "open" | "future" | "closed" | "unknown";

export const registrationState = (opensAt: string | null | undefined, closesAt: string | null | undefined, now: Date): RegistrationState => {
  if (!opensAt) return "unknown";
  if (closesAt && Date.parse(closesAt) < now.getTime()) return "closed";
  const days = calendarDayDistance(opensAt, now);
  if (days === null) return "unknown";
  if (days < 0 || Date.parse(opensAt) <= now.getTime()) return "open";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 3) return "two-three";
  if (days <= 7) return "four-seven";
  if (days <= 14) return "eight-fourteen";
  return "future";
};

export const homeTrainingEnrollmentRank = (opensAt: string | null | undefined, closesAt: string | null | undefined, now: Date) => {
  const state = registrationState(opensAt, closesAt, now);
  if (state === "open") return closesAt && Date.parse(closesAt) - now.getTime() <= 3 * 86_400_000 ? 2 : 0;
  if (["today", "tomorrow", "two-three", "four-seven", "eight-fourteen"].includes(state)) return 1;
  return 3;
};

const registrationRank: Record<RegistrationState, number> = { today: 0, tomorrow: 1, "two-three": 2, "four-seven": 3, "eight-fourteen": 4, open: 5, future: 9, closed: 10, unknown: 10 };
const urgencyPoints: Record<RegistrationState, number> = { today: 50, tomorrow: 45, "two-three": 40, "four-seven": 30, "eight-fourteen": 20, open: 10, future: 0, closed: -1000, unknown: -1000 };
export const trainingPriorityScore = (candidate: HomePriorityCandidate, now: Date) => (candidate.matchScore ?? 50) * 2 + urgencyPoints[registrationState(candidate.registrationOpensAt, candidate.registrationClosesAt, now)];

export const homePriority = (candidate: HomePriorityCandidate, now: Date) => {
  if (candidate.kind === "capacitacion") {
    const rank = registrationRank[registrationState(candidate.registrationOpensAt, candidate.registrationClosesAt, now)];
    if (rank <= 5) return rank;
  }
  if (candidate.kind === "vacante" && candidate.matched) return 6;
  if (candidate.inAgenda) return 7;
  return candidate.matched ? 8 : 9;
};

export const compareHomePriority = (left: HomePriorityCandidate, right: HomePriorityCandidate, now: Date) => {
  const leftState = left.kind === "capacitacion" ? registrationState(left.registrationOpensAt, left.registrationClosesAt, now) : "unknown";
  const rightState = right.kind === "capacitacion" ? registrationState(right.registrationOpensAt, right.registrationClosesAt, now) : "unknown";
  if (registrationRank[leftState] <= 5 && registrationRank[rightState] <= 5) {
    const combined = trainingPriorityScore(right, now) - trainingPriorityScore(left, now);
    if (combined) return combined;
  }
  const rank = homePriority(left, now) - homePriority(right, now);
  if (rank) return rank;
  const leftDate = Date.parse(left.registrationOpensAt || left.eventAt || "") || Number.MAX_SAFE_INTEGER;
  const rightDate = Date.parse(right.registrationOpensAt || right.eventAt || "") || Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
};

