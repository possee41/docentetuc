import test from "node:test";
import assert from "node:assert/strict";
import { cachedWeather, greetingForHour, localTime, parseCurrentWeather, WEATHER_CACHE_MS, weatherCondition } from "./home-context.ts";

test("saluda según las tres franjas de la hora local, incluidos los límites", () => {
  for (const hour of [0, 4, 23]) assert.equal(greetingForHour(hour), "Buenas noches");
  for (const hour of [5, 11]) assert.equal(greetingForHour(hour), "Buenos días");
  for (const hour of [12, 19]) assert.equal(greetingForHour(hour), "Buenas tardes");
  assert.equal(greetingForHour(20), "Buenas noches");
});

test("cambia de saludo al cruzar cada franja horaria local", () => {
  const date = new Date(2026, 8, 30, 4, 59);
  const sequence: Array<[number, number, string]> = [[5, 0, "Buenos días"], [12, 0, "Buenas tardes"], [20, 0, "Buenas noches"]];
  assert.equal(greetingForHour(date.getHours()), "Buenas noches");
  for (const [hour, minute, expected] of sequence) {
    date.setHours(hour, minute);
    assert.equal(greetingForHour(date.getHours()), expected);
  }
});

test("formatea la hora local del dispositivo con dos dígitos", () => {
  const date = new Date(2026, 8, 30, 1, 5);
  assert.equal(localTime(date), "01:05");
  date.setHours(20, 0);
  assert.equal(localTime(date), "20:00");
});

test("interpreta únicamente datos meteorológicos válidos de la API", () => {
  assert.deepEqual(parseCurrentWeather({ current: { temperature_2m: 18.4, weather_code: 0, is_day: 0 } }), { temperature: 18, condition: "Despejado", icon: "🌙" });
  assert.deepEqual(weatherCondition(2, true), { condition: "Parcialmente nublado", icon: "⛅" });
  assert.equal(parseCurrentWeather({ current: { temperature_2m: null, weather_code: 0, is_day: 1 } }), null);
  assert.equal(parseCurrentWeather({ current: { temperature_2m: 18, weather_code: 500, is_day: 1 } }), null);
});

test("usa solo clima cacheado vigente y vuelve al fallback al vencer", () => {
  const weather = { temperature: 24, condition: "Despejado", icon: "☀️" };
  const entry = { fetchedAt: 1000, weather };
  assert.deepEqual(cachedWeather(entry, 1000 + WEATHER_CACHE_MS - 1), weather);
  assert.equal(cachedWeather(entry, 1000 + WEATHER_CACHE_MS), null);
  assert.equal(cachedWeather(entry, 999), null);
  assert.equal(cachedWeather({ fetchedAt: 1000, weather: { temperature: NaN, condition: "", icon: "" } }, 1001), null);
});
