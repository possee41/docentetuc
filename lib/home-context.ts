export const WEATHER_CACHE_MS = 30 * 60 * 1000;

export type HomeWeather = { temperature: number; condition: string; icon: string };

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function localTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function weatherCondition(code: number, isDay: boolean): Pick<HomeWeather, "condition" | "icon"> | null {
  if (code === 0) return { condition: "Despejado", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { condition: "Mayormente despejado", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { condition: "Parcialmente nublado", icon: "⛅" };
  if (code === 3) return { condition: "Nublado", icon: "☁️" };
  if (code === 45 || code === 48) return { condition: "Niebla", icon: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: "Llovizna", icon: "🌦️" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: "Lluvia", icon: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: "Nieve", icon: "🌨️" };
  if ([95, 96, 99].includes(code)) return { condition: "Tormenta", icon: "⛈️" };
  return null;
}

export function parseCurrentWeather(value: unknown): HomeWeather | null {
  if (!value || typeof value !== "object" || !("current" in value)) return null;
  const current = value.current;
  if (!current || typeof current !== "object" || !("temperature_2m" in current) || !("weather_code" in current) || !("is_day" in current)) return null;
  const temperature = current.temperature_2m;
  const code = current.weather_code;
  const isDay = current.is_day;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < -100 || temperature > 70 || typeof code !== "number" || !Number.isInteger(code) || (isDay !== 0 && isDay !== 1)) return null;
  const summary = weatherCondition(code, isDay === 1);
  return summary ? { temperature: Math.round(temperature), ...summary } : null;
}

export function cachedWeather(value: unknown, now: number): HomeWeather | null {
  if (!value || typeof value !== "object" || !("fetchedAt" in value) || !("weather" in value)) return null;
  const fetchedAt = value.fetchedAt;
  const weather = value.weather;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || now < fetchedAt || now - fetchedAt >= WEATHER_CACHE_MS || !weather || typeof weather !== "object" || !("temperature" in weather) || !("condition" in weather) || !("icon" in weather)) return null;
  if (typeof weather.temperature !== "number" || !Number.isFinite(weather.temperature) || typeof weather.condition !== "string" || typeof weather.icon !== "string") return null;
  return weather as HomeWeather;
}
