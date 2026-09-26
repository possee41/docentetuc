export function safeDate(value: string | null) {
  if (!value) return null;
  let normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T12:00:00-03:00";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
