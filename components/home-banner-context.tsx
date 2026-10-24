"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sectionUrl } from "@/lib/app-navigation";
import { cachedWeather, greetingForHour, localTime, parseCurrentWeather, WEATHER_CACHE_MS, type HomeWeather } from "@/lib/home-context";
import type { PublicNewsItem } from "@/lib/public-news";

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

const newsDate = (value: string) => new Intl.DateTimeFormat("es-AR", {
  day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Tucuman",
}).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value));

export function HomeNewsCarousel({ name, excludedOriginIds }: { name?: string; excludedOriginIds: string[] }) {
  const [items, setItems] = useState<PublicNewsItem[]>([]);
  const [index, setIndex] = useState(0);
  const lastInteraction = useRef(0), hovered = useRef(false), focused = useRef(false);
  const touchX = useRef<number | null>(null), lastSwipe = useRef(0);
  const excluded = excludedOriginIds.join(",");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/news?home=1&exclude=${encodeURIComponent(excluded)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ items: PublicNewsItem[] }> : Promise.reject())
      .then((result) => { setItems(result.items); setIndex(0); })
      .catch(() => { if (!controller.signal.aborted) setItems([]); });
    return () => controller.abort();
  }, [excluded]);

  useEffect(() => {
    if (!items.length) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = setInterval(() => {
      if (!motion.matches && document.visibilityState === "visible" && !hovered.current && !focused.current
        && Date.now() - lastInteraction.current >= 12_000) setIndex((current) => (current + 1) % (items.length + 1));
    }, 6_000);
    return () => clearInterval(timer);
  }, [items.length]);

  const move = (step: number) => {
    lastInteraction.current = Date.now();
    setIndex((current) => (current + step + items.length + 1) % (items.length + 1));
  };

  return <div className="home-carousel" role="region" aria-roledescription="carrusel" aria-label="Noticias destacadas de DocenteTuc"
    onPointerEnter={(event) => { if (event.pointerType === "mouse") hovered.current = true; }}
    onPointerLeave={() => { hovered.current = false; }}
    onFocusCapture={() => { focused.current = true; }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) focused.current = false; }}
    onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null; }}
    onTouchEnd={(event) => {
      if (touchX.current === null) return;
      const distance = event.changedTouches[0].clientX - touchX.current;
      touchX.current = null;
      if (Math.abs(distance) >= 45) { lastSwipe.current = Date.now(); move(distance < 0 ? 1 : -1); }
    }}>
    <div className={`home-carousel-slide home-carousel-original ${index === 0 ? "is-active" : ""}`} aria-hidden={index !== 0}>
      <div className="home-hero-copy"><HomeBannerContext name={name} /></div>
    </div>
    {items.map((item, position) => <div key={item.id} className={`home-carousel-slide home-carousel-news ${index === position + 1 ? "is-active" : ""}`} aria-hidden={index !== position + 1}>
      {item.image && <Image src={item.image.url} alt={item.image.alt} fill unoptimized sizes="(max-width: 768px) 100vw, 900px" className="home-carousel-image" />}
      <a href={`${sectionUrl("noticias")}&news=${encodeURIComponent(item.id)}`} tabIndex={index === position + 1 ? 0 : -1}
        onClick={(event) => { if (Date.now() - lastSwipe.current < 500) event.preventDefault(); }}
        className="home-carousel-news-link" aria-label={`Leer noticia: ${item.title}`}>
        <span className="home-carousel-news-content">
          <span className="home-carousel-kicker">{item.relevance === "urgente" ? "Urgente" : item.featured ? "Noticia destacada" : "Actualidad educativa"}{item.image.kind === "illustration" ? " · Ilustración" : ""}</span>
          <strong>{item.title}</strong>
          <span>Fuente {item.primarySource.type === "official" ? "oficial" : "verificable"} · {item.primarySource.name} · {newsDate(item.primarySource.publishedAt || item.publishedAt)}</span>
        </span>
      </a>
    </div>)}
    {items.length > 0 && <>
      <div className="home-carousel-dots" aria-label="Elegir pantalla del carrusel">
        {Array.from({ length: items.length + 1 }, (_, position) => <button key={position} type="button"
          aria-label={position === 0 ? "Mostrar banner de DocenteTuc" : `Mostrar noticia ${position} de ${items.length}`}
          aria-current={index === position ? "true" : undefined} onClick={() => { lastInteraction.current = Date.now(); setIndex(position); }}>
          <span /></button>)}
      </div>
      <div className="home-carousel-arrows">
        <button type="button" aria-label="Pantalla anterior" onClick={() => move(-1)}><ChevronLeft className="size-5" /></button>
        <button type="button" aria-label="Pantalla siguiente" onClick={() => move(1)}><ChevronRight className="size-5" /></button>
      </div>
    </>}
  </div>;
}
