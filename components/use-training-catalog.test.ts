import assert from "node:assert/strict";
import test from "node:test";
import { fetchTrainingCatalog } from "./use-training-catalog.ts";

test("Todas recibe FDCI, INFoD y CeNET más allá de las 400 filas iniciales", async () => {
  const sources = ["Capacitación Docente", "INFoD / AulaS-TIC", "CeNET / INET"];
  const rows = Array.from({ length: 481 }, (_, index) => ({ id: `training:${index}`, source: sources[index % 3] }));
  let calls = 0;
  const fetcher = async (url: string) => {
    const params = new URL(url, "https://docentetuc.com.ar").searchParams;
    assert.equal(params.get("kind"), "capacitacion");
    assert.equal(params.get("limit"), "80");
    const start = Number(params.get("cursor") || 0);
    calls++;
    return Response.json({ items: rows.slice(start, start + 80), nextCursor: start + 80 < rows.length ? String(start + 80) : null });
  };
  const found = await fetchTrainingCatalog(fetcher as typeof fetch);
  assert.equal(calls, 7);
  assert.equal(found.length, 481);
  assert.equal(found.at(-1)?.id, "training:480");
  assert.ok(sources.every(source => found.some(item => item.source === source)));
});

test("un cursor repetido detiene la carga y no presenta una lista incompleta como completa", async () => {
  const fetcher = async () => Response.json({ items: [{ id: "training:1" }], nextCursor: "repeat" });
  await assert.rejects(fetchTrainingCatalog(fetcher as typeof fetch), /PAGE_INVALID/);
});
