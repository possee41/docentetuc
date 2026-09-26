import assert from "node:assert/strict";
import test from "node:test";
import { buildAIContext, retrievePublications } from "./ai.ts";
import type { Publication } from "./types.ts";

const base = { source: "Capacitación Docente", external_id: "1", kind: "capacitacion", category: "Capacitación", summary: "", level: "Secundario", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, official_url: "https://oficial.test/1", metadata: "{}", first_seen_at: "2026-09-01", updated_at: "2026-09-26" } as Publication;
const records = [{ ...base, id: "next", title: "Curso próximo", status: "próximamente" }, { ...base, id: "open", title: "Curso abierto", status: "inscripción abierta" }] as Publication[];

test("recupera primero la próxima inscripción usando datos reales", () => assert.equal(retrievePublications("¿Qué capacitación abre primero?", records)[0]?.id, "next"));
test("no agrega el perfil al contexto sin autorización", () => assert.match(buildAIContext("capacitaciones", records).context, /no autorizó usar su perfil/));
