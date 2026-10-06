"use client";

import { useEffect, useState } from "react";
import { cachedWeather, greetingForHour, localTime, parseCurrentWeather, WEATHER_CACHE_MS, type HomeWeather } from "@/lib/home-context";

const WEATHER_CACHE_KEY = "docentetuc-weather-tucuman-v1";
// San Miguel de Tucumán is the fixed reference point; no device location is requested.
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=-26.8241&longitude=-65.2226&current=temperature_2m,weather_code,is_day&temperature_unit=celsius&timezone=America%2FArgentina%2FTucuman&forecast_days=1";

export function HomeBannerContext({ name }: { name?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<HomeWeather | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - Date.now() % 60_000 + 50);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      let cached: HomeWeather | null = null;
      try {
        const stored = localStorage.getItem(WEATHER_CACHE_KEY);
        cached = stored ? cachedWeather(JSON.parse(stored), Date.now()) : null;
      } catch { /* Storage may be unavailable; the time-only fallback still works. */ }
      if (active) setWeather(cached);
      if (cached || !navigator.onLine || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(WEATHER_URL, { signal: AbortSignal.timeout(7000) });
        if (!response.ok) return;
        const current = parseCurrentWeather(await response.json());
        if (!current || !active) return;
        setWeather(current);
        try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), weather: current })); } catch { /* Weather remains visible for this visit. */ }
      } catch { /* A failed request leaves the time-only fallback visible. */ }
      finally { inFlight = false; }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const interval = setInterval(() => void refresh(), WEATHER_CACHE_MS);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const firstName = name?.trim().split(/\s+/)[0];
  return <div className="home-hero-context">
    <p className="home-hero-greeting">{now ? greetingForHour(now.getHours()) : "Hola"}{firstName ? `, ${firstName}` : ""} 👋</p>
    {now && <p className="home-hero-weather"><time dateTime={localTime(now)}>{localTime(now)}</time>{weather && <> <span aria-hidden="true">·</span> {weather.temperature} °C <span aria-hidden="true">·</span> {weather.condition} {weather.icon}</>}</p>}
    <p className="home-hero-location">Tucumán</p>
  </div>;
}
